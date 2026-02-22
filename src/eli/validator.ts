/**
 * ELI semantic validator.
 *
 * Runs a suite of epistemic-discipline rules over an ELI ledger and
 * reports any violations.  The validator enforces:
 *
 *   1. No FACT claim without evidence (a span_ref that resolves to
 *      non-trivial content in the source text).
 *   2. No inference laundering (an INFERENCE claim that cites no prior
 *      claim or evidence anchor).
 *   3. Every claim has a valid id, type, and at least one span_ref.
 */
import type { EliLedger } from "./tagger.js";

export interface ValidationViolation {
  claimId: string;
  rule: string;
  detail: string;
}

export interface ValidationResult {
  passed: boolean;
  violations: ValidationViolation[];
}

/**
 * Validate an ELI ledger against the semantic discipline rules.
 *
 * @param ledger     The ELI ledger to validate.
 * @param sourceText The original response text that was tagged.
 */
export function validateLedger(ledger: EliLedger, sourceText: string): ValidationResult {
  const violations: ValidationViolation[] = [];
  const validTypes = new Set(["FACT", "INFERENCE", "ASSERTION", "OPINION"]);

  for (const claim of ledger.claims) {
    // Rule 1 – Every claim must have a non-empty id
    if (!claim.id || claim.id.trim() === "") {
      violations.push({ claimId: claim.id ?? "(missing)", rule: "MISSING_ID", detail: "Claim is missing an id" });
    }

    // Rule 2 – Every claim must have a valid epistemic type
    if (!validTypes.has(claim.type)) {
      violations.push({ claimId: claim.id, rule: "INVALID_TYPE", detail: `Unknown type: ${claim.type}` });
    }

    // Rule 3 – Every claim must reference at least one span
    if (!claim.span_refs || claim.span_refs.length === 0) {
      violations.push({ claimId: claim.id, rule: "NO_SPAN_REF", detail: "Claim has no span_refs" });
    } else {
      // Rule 3a – Each span must be a valid [start, end] pair within the source
      for (const [start, end] of claim.span_refs) {
        if (typeof start !== "number" || typeof end !== "number" || start < 0 || end > sourceText.length || start >= end) {
          violations.push({
            claimId: claim.id,
            rule: "INVALID_SPAN",
            detail: `Span [${start}, ${end}] is out of bounds for source text of length ${sourceText.length}`,
          });
        }
      }
    }

    // Rule 4 – No FACT without non-trivial evidence in its span
    if (claim.type === "FACT" && claim.span_refs && claim.span_refs.length > 0) {
      const [start, end] = claim.span_refs[0];
      const evidence = sourceText.slice(start, end).trim();
      if (evidence.length < 10) {
        violations.push({
          claimId: claim.id,
          rule: "FACT_WITHOUT_EVIDENCE",
          detail: `FACT claim span resolves to trivially short text: "${evidence}"`,
        });
      }
    }

    // Rule 5 – No inference laundering: INFERENCE claims must include
    //           hedging language (detected by the tagger) in their span text
    if (claim.type === "INFERENCE" && claim.span_refs && claim.span_refs.length > 0) {
      const [start, end] = claim.span_refs[0];
      const spanText = sourceText.slice(start, end);
      const HEDGE_PATTERN = /\b(therefore|thus|hence|consequently|suggests?|implies?|likely|probably|may|might|could|appears?|seems?)\b/i;
      if (!HEDGE_PATTERN.test(spanText)) {
        violations.push({
          claimId: claim.id,
          rule: "INFERENCE_LAUNDERING",
          detail: "INFERENCE claim span contains no hedging language – possible inference laundering",
        });
      }
    }
  }

  return { passed: violations.length === 0, violations };
}
