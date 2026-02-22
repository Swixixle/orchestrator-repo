/**
 * HALO receipt verifier.
 *
 * Verifies that a receipt envelope has not been tampered with by
 * re-deriving the hash and signature from the stored response and
 * comparing them against the values in the envelope.
 */
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { HaloReceipt } from "./signer.js";

export interface VerifyResult {
  valid: boolean;
  /** Human-readable reason when `valid` is false */
  reason?: string;
}

/**
 * Verify a HALO receipt.
 *
 * @param receipt    The receipt envelope to verify.
 * @param signingKey Hex-encoded 32-byte HMAC secret.  Falls back to the
 *                   `HALO_SIGNING_KEY` environment variable when omitted.
 */
export function verifyReceipt(receipt: HaloReceipt, signingKey?: string): VerifyResult {
  const key = signingKey ?? process.env.HALO_SIGNING_KEY ?? "test-signing-key-32-bytes-padded!";

  // 1. Re-derive the response hash and compare
  const expectedHash = createHash("sha256").update(receipt.response, "utf8").digest("hex");
  if (expectedHash !== receipt.responseHash) {
    return { valid: false, reason: "response hash mismatch – content may have been tampered" };
  }

  // 2. Re-derive and compare the HMAC signature (constant-time comparison)
  const payload = `${receipt.id}|${receipt.timestamp}|${receipt.responseHash}`;
  const expectedSig = createHmac("sha256", key).update(payload, "utf8").digest("hex");
  const sigBuffer = Buffer.from(receipt.signature, "hex");
  const expectedBuffer = Buffer.from(expectedSig, "hex");

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: "signature length mismatch" };
  }

  if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, reason: "signature mismatch – receipt may have been forged" };
  }

  return { valid: true };
}
