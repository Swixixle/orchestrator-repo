/**
 * Ambient type declarations for the optional halo-receipts package.
 *
 * These declarations allow TypeScript to accept imports from halo-receipts
 * without requiring the package to be present at compile time.  The actual
 * runtime behaviour is gated by the try/catch in haloReceiptsAdapter.ts.
 *
 * Update the signatures here once the exact export shapes are confirmed.
 */

declare module "halo-receipts/server/llm/invokeLLMWithHalo.js" {
  export function invokeLLMWithHalo(payload: Record<string, unknown>): Promise<{
    outputText: string;
    provenance: unknown;
    haloReceipt: unknown;
    /** The exact transcript object that was signed */
    transcript: unknown;
  }>;
}

declare module "halo-receipts" {
  /** Verify a forensic pack (preferred export name). */
  export function verifyForensicPack(
    transcript: unknown,
    receipt: unknown
  ): Promise<{ ok: boolean; errors?: string[] }>;

  /** Verify a receipt (fallback export name). */
  export function verifyReceipt(
    transcript: unknown,
    receipt: unknown
  ): Promise<{ ok: boolean; errors?: string[] }>;
}
