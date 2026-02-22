/**
 * HALO mock – re-exports the toy signer and verifier for use in unit tests.
 *
 * These implementations are ONLY for deterministic, keyless unit tests.
 * The E2E test path uses src/adapters/haloReceiptsAdapter.ts instead.
 */
export { signResponse, type HaloReceipt } from "../halo/signer.js";
export { verifyReceipt, type VerifyResult } from "../halo/verifier.js";
