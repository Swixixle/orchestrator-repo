/**
 * HALO Receipts Adapter – delegates entirely to the halo-receipts package
 * via the versioned integration contract (haloReceiptsContract.ts).
 *
 * No local crypto. No guessed export names. No deep-path guessing.
 * All signing and verification is performed by halo-receipts primitives
 * loaded through the contract.
 *
 * Install halo-receipts for E2E:
 *   npm install github:Swixixle/HALO-RECEIPTS#main
 *
 * Environment variables (all required when RUN_E2E=1):
 *   OPENAI_API_KEY        – provider credential (never included in receipt)
 *   RECEIPT_SIGNING_KEY   – Ed25519 private key for halo-receipts signing
 *   RECEIPT_VERIFY_KEY    – Ed25519 public key for receipt verification
 *   RECEIPT_KEY_ID        – key identifier for halo-receipts (if required)
 *   E2E_ENDPOINT          – "/chat/completions" (default) or "/responses"
 *   E2E_MODEL             – model name (default: "gpt-4.1-mini")
 *   HALO_RECEIPTS_CONTRACT_VERSION – (optional) enforce a specific contract version
 */

import { loadHaloReceiptsContract } from "./haloReceiptsContract.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface InvokeLLMWithHaloArgs {
  endpoint: "/chat/completions" | "/responses";
  model: string;
  promptOrMessages: string | Array<{ role: string; content: string }>;
}

export interface InvokeLLMWithHaloResult {
  outputText: string;
  provenance: unknown;
  haloReceipt: unknown;
  /** The exact transcript object that was signed by halo-receipts */
  transcript: unknown;
}

export interface HaloVerifyResult {
  ok: boolean;
  errors?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMessages(
  promptOrMessages: string | Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  return typeof promptOrMessages === "string"
    ? [{ role: "user", content: promptOrMessages }]
    : promptOrMessages;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Invoke an LLM via the halo-receipts contract.
 *
 * The contract wraps `invokeLLMWithHalo` to inject `haloSignTranscript` and
 * capture the transcript for later verification. The `__endpoint` field routes
 * the request inside halo-receipts and is stripped before reaching the provider.
 */
export async function invokeLLMWithHaloAdapter(
  args: InvokeLLMWithHaloArgs
): Promise<InvokeLLMWithHaloResult> {
  const contract = await loadHaloReceiptsContract();

  const { endpoint, model, promptOrMessages } = args;
  const messages = buildMessages(promptOrMessages);

  const requestPayload: Record<string, unknown> =
    endpoint === "/chat/completions"
      ? { __endpoint: "/chat/completions", messages, model }
      : { __endpoint: "/responses", input: messages, model };

  return contract.invokeLLMWithHalo({ model, requestPayload });
}

/**
 * Verify a HALO transcript receipt via the halo-receipts contract.
 *
 * Always verifies the transcript hash. Also verifies the Ed25519 signature
 * when RECEIPT_VERIFY_KEY is set in the environment.
 *
 * Returns { ok: true } when all checks pass, or
 * { ok: false, errors: [...] } describing exactly what failed.
 */
export async function verifyHaloReceiptAdapter(
  transcript: unknown,
  haloReceipt: unknown
): Promise<HaloVerifyResult> {
  const contract = await loadHaloReceiptsContract();
  return contract.verifyTranscriptReceipt(transcript, haloReceipt);
}
