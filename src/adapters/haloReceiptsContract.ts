/**
 * HALO-RECEIPTS integration contract.
 *
 * This is the single module that loads from halo-receipts.
 * It validates the exact exports needed, wraps them for this
 * orchestrator's use, and fails fast with precise diagnostics
 * if the contract surface drifts.
 *
 * One import path per sub-module. No root "halo-receipts" import.
 * No guessed export names. One place to fix when halo-receipts changes.
 *
 * Override the expected contract version via:
 *   HALO_RECEIPTS_CONTRACT_VERSION=1.0.0
 */

import { verify as cryptoVerify } from "node:crypto";

// ── Contract version ──────────────────────────────────────────────────────────

/** Contract version this orchestrator is pinned to. */
export const DEFAULT_CONTRACT_VERSION = "1.0.0";

// ── Public types ──────────────────────────────────────────────────────────────

export interface HaloTranscriptReceipt {
  id: string;
  ts: string;
  transcript_hash: string;
  signature: string;
  signature_alg: "Ed25519";
  public_key_id: string;
  signed_payload: string;
}

export interface HaloReceiptsContract {
  /**
   * Invoke an LLM via halo-receipts, capturing the signed transcript.
   *
   * Wraps the package's `invokeLLMWithHalo` to inject `haloSignTranscript`
   * as a dependency and intercept the transcript for later verification.
   */
  invokeLLMWithHalo: (input: {
    model: string;
    requestPayload: Record<string, unknown>;
  }) => Promise<{
    outputText: string;
    provenance: Record<string, unknown>;
    haloReceipt: HaloTranscriptReceipt;
    /** The exact transcript object that was signed */
    transcript: unknown;
  }>;

  /**
   * Verify a HALO transcript receipt.
   *
   * Always checks the transcript hash using HALO-RECEIPTS canonicalisation
   * primitives. Also verifies the Ed25519 signature when RECEIPT_VERIFY_KEY
   * is set in the environment.
   *
   * Returns { ok: true } when all checks pass, or
   * { ok: false, errors: [...] } describing exactly what failed.
   */
  verifyTranscriptReceipt: (
    transcript: unknown,
    haloReceipt: unknown
  ) => Promise<{ ok: boolean; errors?: string[] }>;

  /** Resolved contract version string. */
  contractVersion: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isModuleNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" ||
      (err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND")
  );
}

// ── Loader ────────────────────────────────────────────────────────────────────

let cached: HaloReceiptsContract | null = null;

/**
 * Load and validate the HALO-RECEIPTS integration contract.
 *
 * - Imports from three known stable sub-paths (never the package root).
 * - Validates every required export is present and callable.
 * - Throws a single clear error message on any failure, listing exactly
 *   which exports were found, which were missing, and how to fix it.
 * - Returns a cached contract object on subsequent calls.
 */
export async function loadHaloReceiptsContract(): Promise<HaloReceiptsContract> {
  if (cached) return cached;

  const contractVersion =
    process.env.HALO_RECEIPTS_CONTRACT_VERSION ?? DEFAULT_CONTRACT_VERSION;

  // ── Step 1: import sub-modules ────────────────────────────────────────────
  // Use .js extension: Vite/vitest maps .js → .ts for TypeScript source.
  // Deep sub-paths avoid depending on the package root entry point
  // (halo-receipts has no main/exports in its package.json).

  let invokeLLMWithHaloRaw: unknown;
  let haloSignTranscriptRaw: unknown;
  let stableStringifyStrictRaw: unknown;
  let sha256HexRaw: unknown;

  try {
    const m = await import("halo-receipts/server/llm/invokeLLMWithHalo.js");
    invokeLLMWithHaloRaw = m.invokeLLMWithHalo;
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new Error(
        "[halo-receipts contract] Package not installed.\n" +
          "  Loaded:   (not found)\n" +
          "  Path:     halo-receipts/server/llm/invokeLLMWithHalo.js\n" +
          "  Fix:      npm install github:Swixixle/HALO-RECEIPTS#main"
      );
    }
    throw err;
  }

  try {
    const m = await import("halo-receipts/server/llm/haloSignTranscript.js");
    haloSignTranscriptRaw = m.haloSignTranscript;
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new Error(
        "[halo-receipts contract] Sub-module not found.\n" +
          "  Path:     halo-receipts/server/llm/haloSignTranscript.js\n" +
          "  Fix:      Pin halo-receipts to a commit that exports haloSignTranscript."
      );
    }
    throw err;
  }

  try {
    const m = await import("halo-receipts/server/audit-canon.js");
    stableStringifyStrictRaw = m.stableStringifyStrict;
    sha256HexRaw = m.sha256Hex;
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new Error(
        "[halo-receipts contract] Sub-module not found.\n" +
          "  Path:     halo-receipts/server/audit-canon.js\n" +
          "  Fix:      Pin halo-receipts to a commit that exports stableStringifyStrict and sha256Hex."
      );
    }
    throw err;
  }

  // ── Step 2: validate required exports ────────────────────────────────────

  const required: [string, unknown][] = [
    ["invokeLLMWithHalo", invokeLLMWithHaloRaw],
    ["haloSignTranscript", haloSignTranscriptRaw],
    ["stableStringifyStrict", stableStringifyStrictRaw],
    ["sha256Hex", sha256HexRaw],
  ];

  const found = required.filter(([, v]) => typeof v === "function").map(([k]) => k);
  const missing = required.filter(([, v]) => typeof v !== "function").map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `[halo-receipts contract] Required exports missing or not functions.\n` +
        `  Contract:  ${contractVersion}\n` +
        `  Found:     ${found.join(", ") || "(none)"}\n` +
        `  Missing:   ${missing.join(", ")}\n` +
        `  Fix:       Pin halo-receipts to a commit that exports all required functions.\n` +
        `             Or update HALO_RECEIPTS_CONTRACT_VERSION to match the installed version.`
    );
  }

  // ── Step 3: cast to known types ───────────────────────────────────────────

  type RawInvoke = (
    deps: { haloSignTranscript: (transcript: unknown) => Promise<unknown> },
    input: { model?: string; requestPayload: Record<string, unknown> }
  ) => Promise<{
    rawResponse: unknown;
    outputText: string;
    provenance: Record<string, unknown>;
    haloReceipt: unknown;
  }>;

  const invokeLLMWithHaloFn = invokeLLMWithHaloRaw as RawInvoke;
  const haloSignTranscriptFn = haloSignTranscriptRaw as (
    transcript: unknown
  ) => Promise<HaloTranscriptReceipt>;
  const stableStringifyStrictFn = stableStringifyStrictRaw as (value: unknown) => string;
  const sha256HexFn = sha256HexRaw as (input: string) => string;

  // ── Step 4: build contract implementation ─────────────────────────────────

  const invokeLLMWithHalo: HaloReceiptsContract["invokeLLMWithHalo"] = async (input) => {
    let capturedTranscript: unknown;

    // Intercept haloSignTranscript to capture the transcript before signing.
    // This is the only way to retrieve the transcript, since the raw
    // invokeLLMWithHalo function builds it internally and does not return it.
    const wrappedSign = async (transcript: unknown): Promise<HaloTranscriptReceipt> => {
      capturedTranscript = transcript;
      return haloSignTranscriptFn(transcript);
    };

    const result = await invokeLLMWithHaloFn({ haloSignTranscript: wrappedSign }, input);

    return {
      outputText: result.outputText,
      provenance: result.provenance,
      haloReceipt: result.haloReceipt as HaloTranscriptReceipt,
      transcript: capturedTranscript,
    };
  };

  const verifyTranscriptReceipt: HaloReceiptsContract["verifyTranscriptReceipt"] = async (
    transcript,
    haloReceipt
  ) => {
    const errors: string[] = [];
    const receipt = haloReceipt as HaloTranscriptReceipt;

    if (!receipt || typeof receipt !== "object") {
      return { ok: false, errors: ["haloReceipt is not an object"] };
    }

    // 1) Hash verification: re-derive transcript_hash using HALO-RECEIPTS
    //    canonicalisation primitives and compare to the value in the receipt.
    let computedHash: string;
    try {
      computedHash = sha256HexFn(stableStringifyStrictFn(transcript));
    } catch (err) {
      return {
        ok: false,
        errors: [`Failed to canonicalise transcript: ${(err as Error).message}`],
      };
    }

    if (computedHash !== receipt.transcript_hash) {
      errors.push(
        `transcript_hash mismatch: computed ${computedHash}, receipt has ${receipt.transcript_hash}`
      );
    }

    // 2) Signature verification (only when RECEIPT_VERIFY_KEY is available).
    //    Verifies the Ed25519 signature over signed_payload using the public key.
    const verifyKeyPem = process.env.RECEIPT_VERIFY_KEY;
    if (verifyKeyPem) {
      try {
        const sigOk = cryptoVerify(
          "ed25519",
          Buffer.from(receipt.signed_payload, "utf8"),
          verifyKeyPem,
          Buffer.from(receipt.signature, "base64")
        );
        if (!sigOk) {
          errors.push("Ed25519 signature verification failed");
        }
      } catch (err) {
        errors.push(`Signature verification error: ${(err as Error).message}`);
      }
    }

    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  };

  cached = { invokeLLMWithHalo, verifyTranscriptReceipt, contractVersion };
  return cached;
}

/** Reset the cached contract — test-only. Do not call in production code. */
export function _resetContractCacheForTest(): void {
  cached = null;
}
