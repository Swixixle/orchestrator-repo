/**
 * HALO-RECEIPTS integration contract.
 *
 * This is the single module that loads from halo-receipts.
 * It validates the exact exports needed, wraps them for this
 * orchestrator's use, and fails fast with precise diagnostics
 * if the contract surface drifts.
 *
 * Imports HALO_RECEIPTS_CONTRACT from the package root entry point.
 * No deep-path assumptions. One place to fix when halo-receipts changes.
 *
 * Override the expected contract version via:
 *   HALO_RECEIPTS_CONTRACT_VERSION=1.0.0
 */

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
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return true;
  if (
    !code &&
    err.message.includes("Cannot find package 'halo-receipts'")
  )
    return true;
  return false;
}

// ── Loader ────────────────────────────────────────────────────────────────────

let cached: HaloReceiptsContract | null = null;

/**
 * Load and validate the HALO-RECEIPTS integration contract.
 *
 * - Imports HALO_RECEIPTS_CONTRACT from the package root (one import, no sub-paths).
 * - Validates every required export is present and callable.
 * - Throws a single clear error message on any failure, listing exactly
 *   which exports were found, which were missing, and how to fix it.
 * - Returns a cached contract object on subsequent calls.
 */
export async function loadHaloReceiptsContract(): Promise<HaloReceiptsContract> {
  if (cached) return cached;

  const contractVersion =
    process.env.HALO_RECEIPTS_CONTRACT_VERSION ?? DEFAULT_CONTRACT_VERSION;

  // ── Step 1: import from package root ─────────────────────────────────────
  // HALO-RECEIPTS exports HALO_RECEIPTS_CONTRACT from its root entry point.
  // A single root import replaces the previous three deep sub-path imports.

  let contractExport: Record<string, unknown>;

  try {
    // Indirect specifier: prevents Vite's import-analysis plugin from attempting
    // to statically resolve "halo-receipts" at transform time.
    const specifier = "halo-receipts";
    const m = await import(/* @vite-ignore */ specifier);
    const raw = (m as Record<string, unknown>).HALO_RECEIPTS_CONTRACT;
    if (!raw || typeof raw !== "object") {
      throw new Error(
        "[halo-receipts contract] HALO_RECEIPTS_CONTRACT not exported from package root.\n" +
          "  Fix:      Pin halo-receipts to a commit that exports HALO_RECEIPTS_CONTRACT."
      );
    }
    contractExport = raw as Record<string, unknown>;
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new Error(
        "[halo-receipts contract] Package not installed.\n" +
          "  Loaded:   (not found)\n" +
          "  Path:     halo-receipts (root)\n" +
          "  Fix:      npm install github:Swixixle/HALO-RECEIPTS#main"
      );
    }
    if (
      err instanceof Error &&
      err.message.includes("Failed to resolve entry for package")
    ) {
      throw new Error(
        "halo-receipts is installed but its entrypoint cannot be resolved.\n" +
          "This indicates a broken installation or incompatible halo-receipts build.\n" +
          "Ensure halo-receipts has dist/ and package.json exports/main/types, then reinstall."
      );
    }
    throw err;
  }

  const invokeLLMWithHaloRaw = contractExport.invokeLLMWithHalo;
  const haloSignTranscriptRaw = contractExport.haloSignTranscript;
  const verifyTranscriptReceiptRaw = contractExport.verifyTranscriptReceipt;

  // ── Step 2: validate required exports ────────────────────────────────────

  const required: [string, unknown][] = [
    ["invokeLLMWithHalo", invokeLLMWithHaloRaw],
    ["haloSignTranscript", haloSignTranscriptRaw],
    ["verifyTranscriptReceipt", verifyTranscriptReceiptRaw],
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
  const verifyTranscriptReceiptFn = verifyTranscriptReceiptRaw as (
    transcript: unknown,
    receipt: HaloTranscriptReceipt
  ) => { ok: boolean; errors?: string[] };

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
    return verifyTranscriptReceiptFn(transcript, haloReceipt as HaloTranscriptReceipt);
  };

  cached = { invokeLLMWithHalo, verifyTranscriptReceipt, contractVersion };
  return cached;
}

/** Reset the cached contract — test-only. Do not call in production code. */
export function _resetContractCacheForTest(): void {
  cached = null;
}
