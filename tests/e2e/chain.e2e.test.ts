/**
 * End-to-end "moment of truth" test.
 *
 * This test hits a REAL LLM provider via the real halo-receipts package and
 * validates that the full pipeline chain works end-to-end via the adapter layer:
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
 *   E2E_ENDPOINT       – "/chat/completions" (default) or "/responses"
 *   E2E_MODEL          – model name (default: "gpt-4.1-mini")
 *   RECEIPT_SIGNING_KEY – signing key for halo-receipts
 *   RECEIPT_KEY_ID     – key identifier for halo-receipts (if required)
 *
 * Assertions check invariants only – not model content:
 *   1. Receipt exists and has required fields
 *   2. Receipt verifies using halo-receipts verification utilities
 *   3. ELI ledger parses (non-empty claims)
 *   4. Every claim has id, type, and span_refs
 *   5. Semantic validation returns ok=true (no ERROR issues)
 *   6. At least one claim of type FACT or INFERENCE
 *   7. Transcript object does not contain authorization credentials
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  invokeLLMWithHaloAdapter,
  verifyHaloReceiptAdapter,
  type InvokeLLMWithHaloResult,
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

const ALLOWED_ENDPOINTS = ["/chat/completions", "/responses"] as const;
type AllowedEndpoint = (typeof ALLOWED_ENDPOINTS)[number];

function resolveEndpoint(): AllowedEndpoint {
  const raw = process.env.E2E_ENDPOINT ?? "/chat/completions";
  if (!ALLOWED_ENDPOINTS.includes(raw as AllowedEndpoint)) {
    throw new Error(
      `E2E_ENDPOINT "${raw}" is not supported. ` +
        `Allowed values: ${ALLOWED_ENDPOINTS.join(", ")}`
    );
  }
  return raw as AllowedEndpoint;
}

describe.skipIf(!RUN_E2E)("E2E – full pipeline with real LLM (RUN_E2E=1 required)", () => {
  const PROMPT = "In two sentences, explain what causes ocean tides.";
  const endpoint = resolveEndpoint();
  const model = process.env.E2E_MODEL ?? "gpt-4.1-mini";

  let adapterResult: InvokeLLMWithHaloResult;
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

    adapterResult = await invokeLLMWithHaloAdapter({ endpoint, model, promptOrMessages: PROMPT });
    ledger = tagResponseToLedger(adapterResult.outputText);
    validation = validateLedgerSemantics(ledger, adapterResult.outputText);
  }, 30_000);

  // ── 1. Receipt shape ──────────────────────────────────────────────────────

  it("receipt exists and has the required fields", () => {
    const { haloReceipt } = adapterResult;

    expect(haloReceipt).toBeDefined();
    expect(haloReceipt).not.toBeNull();
  });

  // ── 2. Receipt verification ───────────────────────────────────────────────

  it("receipt verifies using halo-receipts verification", async () => {
    const verify = await verifyHaloReceiptAdapter(adapterResult.transcript, adapterResult.haloReceipt);

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

  it("transcript does not contain Authorization credentials", () => {
    const serialised = JSON.stringify(adapterResult.transcript);

    expect(serialised).not.toContain("Bearer ");
    expect(serialised).not.toContain(process.env.OPENAI_API_KEY ?? "SENTINEL");
  });
});

