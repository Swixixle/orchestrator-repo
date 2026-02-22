/**
 * End-to-end "moment of truth" test.
 *
 * This test hits a REAL LLM provider and validates that the full pipeline
 * chain works end-to-end via the adapter layer:
 *
 *   invokeLLMWithHaloAdapter → HALO receipt → verifyHaloReceiptAdapter
 *   → tagResponseToLedger → validateLedgerSemantics
 *
 * It is EXPLICITLY OPT-IN.  It only runs when the `RUN_E2E=1` environment
 * variable is set.  It must never be included in default CI.
 *
 * Run locally:
 *   RUN_E2E=1 OPENAI_API_KEY=sk-... npm run test:e2e
 *
 * Optional env vars:
 *   E2E_ENDPOINT  – "/chat/completions" (default) or "/responses"
 *   E2E_MODEL     – model name (default: "gpt-4.1-mini")
 *   RECEIPT_SIGNING_KEY – HMAC signing key (falls back to HALO_SIGNING_KEY)
 *
 * Assertions check invariants only – not model content:
 *   1. Receipt exists and has required fields
 *   2. Receipt verifies (signature + hashes)
 *   3. ELI ledger parses (non-empty claims)
 *   4. Every claim has id, type, and span_refs
 *   5. Semantic validation returns ok=true (no ERROR issues)
 *   6. At least one claim of type FACT or INFERENCE
 *   7. Transcript/provenance does not contain authorization credentials
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  invokeLLMWithHaloAdapter,
  verifyHaloReceiptAdapter,
  type HaloAdapterResult,
} from "../../src/adapters/haloReceiptsAdapter.js";
import {
  tagResponseToLedger,
  validateLedgerSemantics,
  type EliLedger,
  type EliValidationResult,
} from "../../src/adapters/eliAdapter.js";

// ── Guard: skip the entire suite unless RUN_E2E=1 ───────────────────────────
const RUN_E2E = process.env.RUN_E2E === "1";

// ── Test suite ───────────────────────────────────────────────────────────────

describe.skipIf(!RUN_E2E)("E2E – full pipeline with real LLM (RUN_E2E=1 required)", () => {
  const PROMPT = "In two sentences, explain what causes ocean tides.";

  let adapterResult: HaloAdapterResult;
  let ledger: EliLedger;
  let validation: EliValidationResult;

  beforeAll(async () => {
    // Fail fast if required secrets are absent
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "E2E requires OPENAI_API_KEY to be set. " +
          "Export it in your shell before running with RUN_E2E=1."
      );
    }

    adapterResult = await invokeLLMWithHaloAdapter(PROMPT);
    ledger = tagResponseToLedger(adapterResult.outputText);
    validation = validateLedgerSemantics(ledger, adapterResult.outputText);
  }, 30_000);

  // ── 1. Receipt shape ──────────────────────────────────────────────────────

  it("receipt exists and has the required fields", () => {
    const { haloReceipt } = adapterResult;

    expect(haloReceipt).toBeDefined();
    expect(haloReceipt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(haloReceipt.timestamp).toBeTruthy();
    expect(haloReceipt.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(haloReceipt.responseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(haloReceipt.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── 2. Receipt verification ───────────────────────────────────────────────

  it("receipt verifies (signature + hashes)", () => {
    const verify = verifyHaloReceiptAdapter(adapterResult.haloReceipt);

    expect(verify.ok).toBe(true);
    expect(verify.errors).toBeUndefined();
  });

  // ── 3. ELI ledger ─────────────────────────────────────────────────────────

  it("ELI ledger parses (non-empty claims)", () => {
    expect(ledger).toBeDefined();
    expect(ledger.claims.length).toBeGreaterThan(0);
  });

  it("every claim has id, type, and span_refs", () => {
    const validTypes = ["FACT", "INFERENCE", "ASSERTION", "OPINION"];

    for (const claim of ledger.claims) {
      expect(claim.id).toBeTruthy();
      expect(validTypes).toContain(claim.type);
      expect(claim.span_refs.length).toBeGreaterThan(0);
    }
  });

  // ── 4. Semantic validation ────────────────────────────────────────────────

  it("semantic validation returns ok=true (no ERROR issues)", () => {
    const errorIssues = validation.issues.filter((i) => i.severity === "ERROR");

    expect(validation.ok).toBe(true);
    expect(errorIssues).toHaveLength(0);
  });

  it("at least one claim of type FACT or INFERENCE", () => {
    const factOrInference = ledger.claims.filter(
      (c) => c.type === "FACT" || c.type === "INFERENCE"
    );

    expect(factOrInference.length).toBeGreaterThan(0);
  });

  // ── 5. Security: no credentials in transcript ─────────────────────────────

  it("provenance and receipt do not contain Authorization credentials", () => {
    const transcript = JSON.stringify({
      provenance: adapterResult.provenance,
      response: adapterResult.haloReceipt.response,
    });

    expect(transcript).not.toContain("Bearer ");
    expect(transcript).not.toContain(process.env.OPENAI_API_KEY ?? "SENTINEL");
  });
});

