/**
 * Orchestrator – wires the full HALO + ELI pipeline.
 *
 * Chain:
 *   invokeLLM (real or mock) → HALO sign → ELI tag → semantic validate
 *
 * The `invokeLLM` function is injected so the orchestrator can be used
 * in both unit tests (with a mock) and the live E2E test (with a real
 * provider client).
 */
import { signResponse } from "./halo/signer.js";
import { verifyReceipt } from "./halo/verifier.js";
import { tagResponse } from "./eli/tagger.js";
import { validateLedger } from "./eli/validator.js";
import type { HaloReceipt } from "./halo/signer.js";
import type { EliLedger } from "./eli/tagger.js";
import type { ValidationResult } from "./eli/validator.js";

export type LLMInvoker = (prompt: string) => Promise<string>;

export interface OrchestrationResult {
  /** The prompt that was sent to the LLM */
  prompt: string;
  /** Raw text response from the LLM */
  llmResponse: string;
  /** HALO receipt envelope */
  receipt: HaloReceipt;
  /** Result of offline receipt verification */
  verification: { valid: boolean; reason?: string };
  /** ELI claim ledger */
  ledger: EliLedger;
  /** Semantic validation result */
  validation: ValidationResult;
}

/**
 * Run the full pipeline for a single prompt.
 *
 * @param prompt     The prompt to send to the LLM.
 * @param invokeLLM  Function that calls the LLM and returns the raw response.
 * @param signingKey Optional override for the HALO signing key.
 */
export async function runPipeline(
  prompt: string,
  invokeLLM: LLMInvoker,
  signingKey?: string
): Promise<OrchestrationResult> {
  // Step 1 – invoke the LLM
  const llmResponse = await invokeLLM(prompt);

  // Step 2 – HALO sign
  const receipt = signResponse(llmResponse, signingKey);

  // Step 3 – offline verify (gate: abort if the receipt is already broken)
  const verification = verifyReceipt(receipt, signingKey);

  // Step 4 – ELI tag
  const ledger = tagResponse(llmResponse);

  // Step 5 – semantic validate
  const validation = validateLedger(ledger, llmResponse);

  return { prompt, llmResponse, receipt, verification, ledger, validation };
}
