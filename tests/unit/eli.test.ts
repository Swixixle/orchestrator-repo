import { describe, it, expect } from "vitest";
import { tagResponse } from "../../src/eli/tagger.js";
import { validateLedger } from "../../src/eli/validator.js";

describe("ELI tagger", () => {
  it("returns an EliLedger with the correct shape", () => {
    const response = "Water boils at 100 degrees Celsius. This suggests the experiment succeeded.";
    const ledger = tagResponse(response);

    expect(ledger.tagged_at).toBeTruthy();
    expect(typeof ledger.sentence_count).toBe("number");
    expect(ledger.sentence_count).toBeGreaterThan(0);
    expect(Array.isArray(ledger.claims)).toBe(true);
  });

  it("tags each sentence with a valid epistemic type", () => {
    const response = "The earth orbits the sun. This implies gravity is real.";
    const ledger = tagResponse(response);
    const validTypes = ["FACT", "INFERENCE", "ASSERTION", "OPINION"];

    for (const claim of ledger.claims) {
      expect(validTypes).toContain(claim.type);
    }
  });

  it("every claim has an id, text, and span_refs", () => {
    const response = "The experiment ran for three days. Results were inconclusive.";
    const ledger = tagResponse(response);

    for (const claim of ledger.claims) {
      expect(claim.id).toBeTruthy();
      expect(claim.text).toBeTruthy();
      expect(claim.span_refs.length).toBeGreaterThan(0);
    }
  });

  it("classifies inference-hedged sentences as INFERENCE", () => {
    const response = "The result therefore suggests a causal link.";
    const ledger = tagResponse(response);

    expect(ledger.claims.length).toBeGreaterThan(0);
    expect(ledger.claims[0].type).toBe("INFERENCE");
  });
});

describe("ELI semantic validator", () => {
  it("passes a well-formed ledger", () => {
    const response = "Water is composed of hydrogen and oxygen. This suggests a chemical bond.";
    const ledger = tagResponse(response);
    const result = validateLedger(ledger, response);

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("reports MISSING_ID for a claim with an empty id", () => {
    const response = "A fact sentence here.";
    const ledger = tagResponse(response);
    ledger.claims[0].id = "";

    const result = validateLedger(ledger, response);

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.rule === "MISSING_ID")).toBe(true);
  });

  it("reports INVALID_TYPE for an unknown epistemic type", () => {
    const response = "Some statement.";
    const ledger = tagResponse(response);
    // @ts-expect-error intentionally setting an invalid type
    ledger.claims[0].type = "UNKNOWN";

    const result = validateLedger(ledger, response);

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.rule === "INVALID_TYPE")).toBe(true);
  });

  it("reports NO_SPAN_REF for a claim with no spans", () => {
    const response = "A statement.";
    const ledger = tagResponse(response);
    ledger.claims[0].span_refs = [];

    const result = validateLedger(ledger, response);

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.rule === "NO_SPAN_REF")).toBe(true);
  });
});
