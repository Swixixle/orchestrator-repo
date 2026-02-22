/**
 * Ambient type declarations for halo-receipts sub-path imports.
 *
 * These declarations match the actual export shapes of the halo-receipts
 * TypeScript source files.  They allow TypeScript to compile without the
 * package present; the runtime behaviour is gated by try/catch inside
 * haloReceiptsContract.ts.
 *
 * Keep these in sync with the pinned halo-receipts commit.
 * Do NOT declare a root "halo-receipts" module here — the package has no
 * root entry point and root imports will fail at Vite analysis time.
 */

declare module "halo-receipts/server/llm/invokeLLMWithHalo.js" {
  /**
   * Gate 0 LLM wrapper.
   * deps.haloSignTranscript is injected by the caller (see haloReceiptsContract.ts).
   */
  export function invokeLLMWithHalo(
    deps: { haloSignTranscript: (transcript: unknown) => Promise<unknown> },
    input: {
      model?: string;
      requestPayload: Record<string, unknown>;
      generationParams?: unknown;
      receiptId?: string;
      userId?: string;
      tenantId?: string;
    }
  ): Promise<{
    rawResponse: unknown;
    outputText: string;
    provenance: Record<string, unknown>;
    haloReceipt: unknown;
  }>;
}

declare module "halo-receipts/server/llm/haloSignTranscript.js" {
  export interface HaloTranscriptReceipt {
    id: string;
    ts: string;
    transcript_hash: string;
    signature: string;
    signature_alg: "Ed25519";
    public_key_id: string;
    signed_payload: string;
  }

  export function haloSignTranscript(transcript: unknown): Promise<HaloTranscriptReceipt>;

  /** Reset cached signing key — test-only. */
  export function _resetReceiptSigningKeyForTest(): void;
}

declare module "halo-receipts/server/audit-canon.js" {
  /** Deterministic canonical JSON serialisation used for hashing. */
  export function stableStringifyStrict(value: unknown): string;

  /** SHA-256 hex digest of the given UTF-8 string. */
  export function sha256Hex(input: string): string;
}
