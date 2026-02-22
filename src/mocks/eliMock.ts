/**
 * ELI mock – re-exports the toy tagger and validator for use in unit tests.
 *
 * These implementations are ONLY for deterministic, keyless unit tests.
 * The E2E test path uses src/adapters/eliAdapter.ts instead.
 */
export { tagResponse, type EliClaim, type EliLedger, type EpiType } from "../eli/tagger.js";
export { validateLedger, type ValidationResult, type ValidationViolation } from "../eli/validator.js";
