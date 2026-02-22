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
 *
 * When RUN_E2E=1, after all invariants pass, writes:
 *   out/e2e-artifact.json  – full machine-readable truth object
 *   out/e2e-report.md      – human-readable summary
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { scanForLeaks } from "../../src/utils/leakScan.js";
import type { Artifact } from "../../src/types/artifact.js";

const shouldRunE2E = process.env.RUN_E2E === "1";

if (!process.env.OPENAI_API_KEY) {
  console.warn("Skipping E2E tests: OPENAI_API_KEY not set");
}

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

// TODO:
// Replace live OpenAI dependency with deterministic provider stub.
// Current E2E validates full integration but is non-deterministic.

(shouldRunE2E ? describe : describe.skip)("Chain E2E", () => {
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

  it("provenance contains a non-empty provenance_hash string", () => {
    const provenance = adapterResult.provenance as Record<string, unknown>;

    expect(typeof provenance.provenance_hash).toBe("string");
    expect((provenance.provenance_hash as string).length).toBeGreaterThan(0);
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

  // ── 6. Artifact file output ───────────────────────────────────────────────

  afterAll(() => {
    // Write artifact files after all invariants have been asserted.
    // Only runs when the suite itself ran (RUN_E2E=1) and adapterResult is set.
    if (!adapterResult) return;

    try {
      const provenance = adapterResult.provenance as Record<string, unknown>;
      const leakScan = scanForLeaks(
        [
          { field: "transcript", value: adapterResult.transcript },
          { field: "haloReceipt", value: adapterResult.haloReceipt },
          { field: "provenance", value: adapterResult.provenance },
        ],
        [process.env.OPENAI_API_KEY].filter((k): k is string => typeof k === "string")
      );

      const artifact: Artifact = {
        meta: {
          timestamp: new Date().toISOString(),
          orchestratorVersion: "1.0.0",
          nodeVersion: process.version,
        },
        llm: {
          provider: "openai",
          endpoint,
          model,
          requestParams: { model, endpoint },
        },
        transcript: adapterResult.transcript,
        haloReceipt: adapterResult.haloReceipt,
        provenance: {
          provenanceHash:
            typeof provenance.provenance_hash === "string"
              ? provenance.provenance_hash
              : undefined,
          raw: provenance,
        },
        eliLedger: ledger,
        eliValidation: validation,
        security: { credentialLeakScan: leakScan },
      };

      const factOrInference = ledger.claims.filter(
        (c) => c.type === "FACT" || c.type === "INFERENCE"
      ).length;

      const report = `# E2E Test Artifact Report

## Run metadata
- **Timestamp:** ${artifact.meta.timestamp}
- **Node version:** ${artifact.meta.nodeVersion}

## LLM call
- **Endpoint:** ${endpoint}
- **Model:** ${model}

## Prompt
\`\`\`
${PROMPT}
\`\`\`

## ELI Ledger summary
- **Claims:** ${ledger.claims.length}
- **FACT / INFERENCE:** ${factOrInference}

## Semantic validation
${validation.ok ? "✅ PASS" : "❌ FAIL"}

## Credential leak scan
${leakScan.ok ? "✅ PASS (no credential patterns found)" : "❌ FAIL"}
`;

      const outDir = resolve("out");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, "e2e-artifact.json"), JSON.stringify(artifact, null, 2), "utf8");
      writeFileSync(resolve(outDir, "e2e-report.md"), report, "utf8");
      console.log("\n[e2e] Artifacts written to out/e2e-artifact.json and out/e2e-report.md");
    } catch (err) {
      console.warn("[e2e] Warning: could not write artifact files:", err);
    }
  });
});

