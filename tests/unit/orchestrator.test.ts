import { describe, it, expect } from "vitest";
import { runPipeline } from "../../src/orchestrator.js";

const TEST_KEY = "test-signing-key-32-bytes-padded!";

const MOCK_RESPONSE =
  "The sky appears blue due to Rayleigh scattering. " +
  "This suggests that shorter wavelengths scatter more. " +
  "Therefore sunsets are red because blue light has already scattered away.";

const mockLLM = async (_prompt: string): Promise<string> => MOCK_RESPONSE;

describe("orchestrator (mocked LLM)", () => {
  it("returns a complete pipeline result", async () => {
    const result = await runPipeline("Explain why the sky is blue.", mockLLM, TEST_KEY);

    expect(result.prompt).toBe("Explain why the sky is blue.");
    expect(result.llmResponse).toBe(MOCK_RESPONSE);
    expect(result.receipt).toBeDefined();
    expect(result.verification).toBeDefined();
    expect(result.ledger).toBeDefined();
    expect(result.validation).toBeDefined();
  });

  it("receipt verifies successfully", async () => {
    const result = await runPipeline("Test prompt", mockLLM, TEST_KEY);

    expect(result.verification.valid).toBe(true);
  });

  it("ELI ledger parses (non-empty claims)", async () => {
    const result = await runPipeline("Test prompt", mockLLM, TEST_KEY);

    expect(result.ledger.claims.length).toBeGreaterThan(0);
  });

  it("semantic validation passes (no violations)", async () => {
    const result = await runPipeline("Test prompt", mockLLM, TEST_KEY);

    expect(result.validation.passed).toBe(true);
    expect(result.validation.violations).toHaveLength(0);
  });

  it("at least one claim has valid id, type, and span_refs", async () => {
    const result = await runPipeline("Test prompt", mockLLM, TEST_KEY);
    const validTypes = ["FACT", "INFERENCE", "ASSERTION", "OPINION"];

    const valid = result.ledger.claims.filter(
      (c) => c.id && validTypes.includes(c.type) && c.span_refs.length > 0
    );
    expect(valid.length).toBeGreaterThan(0);
  });
});
