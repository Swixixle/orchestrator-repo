/**
 * HALO Receipts Adapter.
 *
 * This adapter is the E2E path for HALO receipt generation and verification.
 * It exposes a stable interface so the E2E test does not touch the toy
 * signer/verifier directly.
 *
 * When HALO-RECEIPTS is published as an npm package, replace the internal
 * crypto logic below with imports from that package:
 *
 *   import { invokeLLMWithHalo, haloSignTranscript, verifyHaloTranscript }
 *     from "halo-receipts";
 *
 * Until then, this adapter uses Node's built-in crypto module with the same
 * HMAC-SHA256 scheme so that behaviour is identical but the import path is
 * cleanly separated from the unit-test mocks.
 */
import { createHmac, createHash, randomUUID, timingSafeEqual } from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HaloAdapterOptions {
  /** Override the OpenAI model (default: E2E_MODEL env var or "gpt-4.1-mini") */
  model?: string;
  /** Override the API endpoint path (default: E2E_ENDPOINT env var or "/chat/completions") */
  endpoint?: string;
}

export interface HaloReceipt {
  id: string;
  timestamp: string;
  /** SHA-256 of the serialised request body (auth-header-free) */
  requestHash: string;
  /** SHA-256 of the raw upstream response text */
  responseHash: string;
  /** HMAC-SHA256 over id|timestamp|requestHash|responseHash */
  signature: string;
  /** The raw upstream response text that was signed */
  response: string;
}

export interface HaloProvenance {
  endpoint: string;
  model: string;
  /** Request payload as sent upstream – auth headers are intentionally absent */
  requestBody: Record<string, unknown>;
  timestamp: string;
  requestHash: string;
  responseHash: string;
}

export interface HaloAdapterResult {
  outputText: string;
  provenance: HaloProvenance;
  haloReceipt: HaloReceipt;
}

export interface HaloVerifyResult {
  ok: boolean;
  errors?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.openai.com/v1";

function resolveSigningKey(): string {
  return (
    process.env.RECEIPT_SIGNING_KEY ??
    process.env.HALO_SIGNING_KEY ??
    "test-signing-key-32-bytes-padded!"
  );
}

function buildPayload(
  prompt: string,
  model: string,
  endpointPath: string
): Record<string, unknown> {
  if (endpointPath === "/chat/completions") {
    return {
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
      temperature: 0,
    };
  }
  if (endpointPath === "/responses") {
    return {
      model,
      input: prompt,
      max_tokens: 256,
      temperature: 0,
    };
  }
  throw new Error(
    `Unknown E2E_ENDPOINT "${endpointPath}". ` +
      'Supported values: "/chat/completions" or "/responses".'
  );
}

function extractText(
  data: unknown,
  endpointPath: string
): string {
  if (endpointPath === "/chat/completions") {
    const d = data as { choices: Array<{ message: { content: string } }> };
    return d.choices[0].message.content;
  }
  if (endpointPath === "/responses") {
    const d = data as { output: Array<{ content: Array<{ text: string }> }> };
    return d.output[0].content[0].text;
  }
  throw new Error(`Cannot extract text for endpoint "${endpointPath}"`);
}

function signTranscript(
  id: string,
  timestamp: string,
  requestHash: string,
  responseHash: string,
  key: string
): string {
  const payload = `${id}|${timestamp}|${requestHash}|${responseHash}`;
  return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Invoke an OpenAI-compatible LLM and produce a tamper-evident HALO receipt.
 *
 * The signed transcript contains only the request body and response text –
 * Authorization headers are never included.
 *
 * Environment variables (all required when RUN_E2E=1):
 *   OPENAI_API_KEY        – provider credential (never included in receipt)
 *   RECEIPT_SIGNING_KEY   – HMAC signing key (falls back to HALO_SIGNING_KEY)
 *   E2E_ENDPOINT          – "/chat/completions" (default) or "/responses"
 *   E2E_MODEL             – model name (default: "gpt-4.1-mini")
 */
export async function invokeLLMWithHaloAdapter(
  prompt: string,
  options: HaloAdapterOptions = {}
): Promise<HaloAdapterResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "E2E requires OPENAI_API_KEY to be set. " +
        "Set it in your environment before running with RUN_E2E=1."
    );
  }

  const endpointPath =
    options.endpoint ?? process.env.E2E_ENDPOINT ?? "/chat/completions";
  const model = options.model ?? process.env.E2E_MODEL ?? "gpt-4.1-mini";

  const requestBody = buildPayload(prompt, model, endpointPath);

  const res = await fetch(`${BASE_URL}${endpointPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Authorization header is intentionally NOT stored in provenance/receipt
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const outputText = extractText(data, endpointPath);

  // Build provenance – auth headers are never included
  const timestamp = new Date().toISOString();
  const requestHash = createHash("sha256")
    .update(JSON.stringify(requestBody), "utf8")
    .digest("hex");
  const responseHash = createHash("sha256")
    .update(outputText, "utf8")
    .digest("hex");

  const provenance: HaloProvenance = {
    endpoint: endpointPath,
    model,
    requestBody,
    timestamp,
    requestHash,
    responseHash,
  };

  // Sign the transcript (no auth headers – requestBody is already auth-free)
  const signingKey = resolveSigningKey();
  const id = randomUUID();
  const signature = signTranscript(id, timestamp, requestHash, responseHash, signingKey);

  const haloReceipt: HaloReceipt = {
    id,
    timestamp,
    requestHash,
    responseHash,
    signature,
    response: outputText,
  };

  return { outputText, provenance, haloReceipt };
}

/**
 * Verify a HALO receipt produced by invokeLLMWithHaloAdapter.
 *
 * Returns { ok: true } when the receipt is untampered, or
 * { ok: false, errors: [...] } describing what failed.
 */
export function verifyHaloReceiptAdapter(receipt: HaloReceipt): HaloVerifyResult {
  const errors: string[] = [];
  const key = resolveSigningKey();

  // 1. Re-derive and compare the response hash
  const expectedResponseHash = createHash("sha256")
    .update(receipt.response, "utf8")
    .digest("hex");
  if (expectedResponseHash !== receipt.responseHash) {
    errors.push("responseHash mismatch – content may have been tampered");
  }

  // 2. Re-derive and compare the HMAC signature
  const expectedSig = signTranscript(
    receipt.id,
    receipt.timestamp,
    receipt.requestHash,
    receipt.responseHash,
    key
  );
  const sigBuf = Buffer.from(receipt.signature, "hex");
  const expBuf = Buffer.from(expectedSig, "hex");
  if (
    sigBuf.length !== expBuf.length ||
    !timingSafeEqual(sigBuf, expBuf)
  ) {
    errors.push("signature mismatch – receipt may have been forged");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
