/**
 * Ambient type declarations for the halo-receipts package root.
 *
 * Declares HALO_RECEIPTS_CONTRACT and its expected shape so that TypeScript
 * can compile without the package present; runtime behaviour is gated by
 * try/catch inside haloReceiptsContract.ts.
 *
 * Keep these in sync with the pinned halo-receipts commit.
 */

declare module "halo-receipts" {
  export interface HaloTranscriptReceipt {
    id: string;
    ts: string;
    transcript_hash: string;
    signature: string;
    signature_alg: "Ed25519";
    public_key_id: string;
    signed_payload: string;
  }

  export interface HaloReceiptsRootContract {
    /** Gate 0 LLM wrapper. deps.haloSignTranscript is injected by the caller. */
    invokeLLMWithHalo(
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

    /** Sign a transcript and return a HALO receipt. */
    haloSignTranscript(transcript: unknown): Promise<HaloTranscriptReceipt>;

    /** Deterministic canonical JSON serialisation used for hashing. */
    stableStringifyStrict(value: unknown): string;

    /** SHA-256 hex digest of the given UTF-8 string. */
    sha256Hex(input: string): string;

    /** Contract version string (e.g. "1.0.0"). */
    version?: string;
  }

  export const HALO_RECEIPTS_CONTRACT: HaloReceiptsRootContract;
}
