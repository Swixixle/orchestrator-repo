/**
 * ELI (Epistemic Ledger of Inferences) tagger.
 *
 * Parses an LLM response and extracts claims, tagging each with an
 * epistemic type (FACT, INFERENCE, ASSERTION, OPINION) and optional
 * span references into the source text.
 *
 * The tagger uses a simple heuristic rule-set as a reference
 * implementation.  In production this should be replaced with the
 * canonical ELI validator/tagger package.
 */

export type EpiType = "FACT" | "INFERENCE" | "ASSERTION" | "OPINION";

export interface EliClaim {
  /** Stable UUID-v4 claim identifier */
  id: string;
  /** Epistemic type of the claim */
  type: EpiType;
  /** The claim text extracted from the response */
  text: string;
  /**
   * Character-offset span references into the original response text.
   * Each entry is [start, end] (inclusive, exclusive).
   */
  span_refs: Array<[number, number]>;
}

export interface EliLedger {
  /** ISO-8601 timestamp the ledger was produced */
  tagged_at: string;
  /** Total number of sentences processed */
  sentence_count: number;
  /** All extracted claims */
  claims: EliClaim[];
}

// Simple heuristic patterns for epistemic classification
const INFERENCE_PATTERNS = [
  /\b(therefore|thus|hence|it follows|consequently|suggests? that|implies? that|so\b)/i,
  /\b(likely|probably|presumably|appears? to|seems? to|may|might|could)\b/i,
];

const OPINION_PATTERNS = [
  /\b(I think|I believe|in my (view|opinion)|arguably|it (seems|appears) that)\b/i,
];

const FACT_MARKERS = [
  /\b(is|are|was|were|has|have|had)\b.*\./,
  /\b\d{4}\b/, // year reference
];

function classifySentence(sentence: string): EpiType {
  if (OPINION_PATTERNS.some((p) => p.test(sentence))) return "OPINION";
  if (INFERENCE_PATTERNS.some((p) => p.test(sentence))) return "INFERENCE";
  if (FACT_MARKERS.some((p) => p.test(sentence))) return "FACT";
  return "ASSERTION";
}

/**
 * Tag an LLM response text and produce an ELI ledger.
 *
 * @param response  Raw text returned by the LLM provider.
 */
export function tagResponse(response: string): EliLedger {
  // Split on sentence boundaries (naïve but sufficient for invariant testing)
  const sentences = response
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const claims: EliClaim[] = [];
  let cursor = 0;

  for (const sentence of sentences) {
    const start = response.indexOf(sentence, cursor);
    const end = start + sentence.length;
    cursor = end;

    claims.push({
      id: crypto.randomUUID(),
      type: classifySentence(sentence),
      text: sentence,
      span_refs: [[start, end]],
    });
  }

  return {
    tagged_at: new Date().toISOString(),
    sentence_count: sentences.length,
    claims,
  };
}
