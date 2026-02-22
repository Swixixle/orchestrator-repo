/**
 * HALO receipt signer.
 *
 * Signs an upstream LLM response and produces a tamper-evident receipt
 * envelope that can be independently verified offline.
 *
 * In production this module should delegate to the canonical HALO-RECEIPTS
 * package.  The implementation here is a self-contained reference that
 * depends only on Node's built-in `crypto` module so the orchestrator can
 * run without an external dependency until the package is published.
 */
import { createHmac, createHash, randomUUID } from "node:crypto";

  /** Unique receipt identifier */
  id: string;
  /** ISO-8601 timestamp of signing */
  timestamp: string;
  /** SHA-256 hash of the raw upstream response (hex) */
  responseHash: string;
  /** HMAC-SHA256 signature over `id|timestamp|responseHash` (hex) */
  signature: string;
  /** The original upstream response that was signed */
  response: string;
  /** Receipt schema version */
  schema_version: string;
}

/**
 * Produce a HALO receipt for an upstream LLM response.
 *
 * @param response   Raw text returned by the LLM provider.
 * @param signingKey Hex-encoded 32-byte HMAC secret.  Falls back to the
 *                   `HALO_SIGNING_KEY` environment variable when omitted.
 */
  const key = signingKey ?? process.env.HALO_SIGNING_KEY ?? "test-signing-key-32-bytes-padded!";
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const responseHash = createHash("sha256").update(response, "utf8").digest("hex");
  const payload = `${id}|${timestamp}|${responseHash}`;
  const signature = createHmac("sha256", key).update(payload, "utf8").digest("hex");
  const schema_version = "1.0.0";

  return { id, timestamp, responseHash, signature, response, schema_version };
}
