/**
 * End-to-end "moment of truth" test.
 *
 * This test hits a REAL LLM provider and validates that the full pipeline
 * chain works end-to-end:
 *
 *   invokeLLMWithHalo → HALO sign → ELI tag → semantic validate
 *
 * It is EXPLICITLY OPT-IN.  It only runs when the `RUN_E2E=1` environment
 * variable is set.  It must never be included in default CI.
 *
 * Run locally:
 *   RUN_E2E=1 OPENAI_API_KEY=sk-... npm run test:e2e
 *
 * Assertions deliberately check invariants only – not model content:
 *   1. Receipt exists
 *   2. Receipt verifies (signature + hashes)
 *   3. ELI ledger parses (non-empty claims)
 *   4. Semantic validation passes (no violations)
 *   5. At least one claim has a valid id / type / span_refs
 */
import { describe, it, expect, beforeAll } from "vitest";
import { runPipeline } from "../../src/orchestrator.js";

// ── Guard: skip the entire suite unless RUN_E2E=1 ───────────────────────────
const RUN_E2E = process.env.RUN_E2E === "1";

/**
 * Minimal OpenAI-compatible LLM invoker.
 * Extend or replace this function for other providers.
 */
async function invokeLLM(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for E2E tests");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe.skipIf(!RUN_E2E)("E2E – full pipeline with real LLM (RUN_E2E=1 required)", () => {
  const PROMPT = "In two sentences, explain what causes ocean tides.";
  let pipelineResult: Awaited<ReturnType<typeof runPipeline>>;

  beforeAll(async () => {
    pipelineResult = await runPipeline(PROMPT, invokeLLM);
  }, 30_000);

  it("receipt exists and has the required fields", () => {
    const { receipt } = pipelineResult;

    expect(receipt).toBeDefined();
    expect(receipt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(receipt.timestamp).toBeTruthy();
    expect(receipt.responseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("receipt verifies (signature + hashes)", () => {
    const { verification } = pipelineResult;

    expect(verification.valid).toBe(true);
    expect(verification.reason).toBeUndefined();
  });

  it("ELI ledger parses (non-empty claims)", () => {
    const { ledger } = pipelineResult;

    expect(ledger).toBeDefined();
    expect(ledger.claims.length).toBeGreaterThan(0);
  });

  it("semantic validation passes (no violations)", () => {
    const { validation } = pipelineResult;

    expect(validation.passed).toBe(true);
    expect(validation.violations).toHaveLength(0);
  });

  it("at least one claim has a valid id, type, and span_refs", () => {
    const { ledger } = pipelineResult;
    const validTypes = ["FACT", "INFERENCE", "ASSERTION", "OPINION"];

    const validClaims = ledger.claims.filter(
      (c) => c.id && validTypes.includes(c.type) && c.span_refs.length > 0
    );

    expect(validClaims.length).toBeGreaterThan(0);
  });
});
