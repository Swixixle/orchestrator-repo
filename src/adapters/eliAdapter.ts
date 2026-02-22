/**
 * ELI (Epistemic Ledger of Inferences) Adapter.
 *
 * This adapter is the E2E path for ELI tagging and semantic validation.
 * It exposes a stable interface so the E2E test does not touch the toy
 * tagger/validator directly.
 *
 * When a real ELI tagger/validator package is available, replace the
 * internal delegations below with imports from that package:
 *
 *   import { tagResponse, validateLedger } from "eli-semantic-validator";
 *
 * Until then, this adapter delegates to the local heuristic implementations
 * so the E2E path is correctly separated from the unit-test mocks.
 */
import { tagResponse } from "../eli/tagger.js";
import { validateLedger } from "../eli/validator.js";
import type { EliLedger } from "../eli/tagger.js";

export type { EliLedger };

// ── Severity matches the "no ERROR issues" invariant required by E2E ─────────

export type IssueSeverity = "ERROR" | "WARNING" | "INFO";

export interface EliIssue {
  claimId: string;
  rule: string;
  detail: string;
  severity: IssueSeverity;
}

export interface EliValidationResult {
  ok: boolean;
  issues: EliIssue[];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Tag an LLM response and produce an ELI claim ledger.
 *
 * Invariants guaranteed by the returned ledger:
 *   - ledger.claims.length > 0  (for non-trivial responses)
 *   - every claim has id, type, span_refs
 *   - at least one claim has type FACT or INFERENCE
 */
export function tagResponseToLedger(outputText: string): EliLedger {
  return tagResponse(outputText);
}

/**
 * Run semantic validation rules over an ELI ledger.
 *
 * Returns { ok: true } when no ERROR-level issues are found.
 * All violations from the underlying validator are mapped to severity ERROR.
 */
export function validateLedgerSemantics(
  ledger: EliLedger,
  sourceText: string
): EliValidationResult {
  const result = validateLedger(ledger, sourceText);
  return {
    ok: result.passed,
    issues: result.violations.map((v) => ({
      claimId: v.claimId,
      rule: v.rule,
      detail: v.detail,
      severity: "ERROR" as IssueSeverity,
    })),
  };
}
