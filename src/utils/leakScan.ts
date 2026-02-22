/**
 * Credential leak scanner.
 *
 * Serialises arbitrary objects to JSON and checks for credential patterns.
 * Used both in the demo CLI (artifact production) and the verify CLI.
 *
 * Patterns checked:
 *   - "Bearer "    – Authorization header value
 *   - API key strings passed via OPENAI_API_KEY (or any sk-... prefix)
 *   - OpenAI key prefix "sk-"
 *
 * Never throws – if a target value cannot be serialised it is skipped with
 * a warning finding instead.
 */
import type { LeakScanFinding, LeakScanResult } from "../types/artifact.js";

// Patterns that must never appear in stored artifacts.
// Each entry is [humanReadablePatternName, RegExp].
const BUILT_IN_PATTERNS: Array<[string, RegExp]> = [
  ["Bearer token header", /Bearer\s+\S+/],
  ["OpenAI key prefix (sk-)", /\bsk-[A-Za-z0-9_-]{10,}/],
];

export interface ScanTarget {
  /** Human-readable field name for reporting */
  field: string;
  /** The value to serialise and scan */
  value: unknown;
}

/**
 * Scan a set of named values for credential patterns.
 *
 * @param targets        Named values to scan.
 * @param extraPatterns  Optional caller-supplied API key strings to add to the
 *                       pattern list (e.g. process.env.OPENAI_API_KEY).
 */
export function scanForLeaks(targets: ScanTarget[], extraPatterns?: string[]): LeakScanResult {
  const patterns: Array<[string, RegExp]> = [...BUILT_IN_PATTERNS];

  // Add any caller-supplied literal key strings (only when non-trivially long)
  if (extraPatterns) {
    for (const key of extraPatterns) {
      if (key && key.length >= 8) {
        patterns.push([`API key (literal)`, new RegExp(escapeRegex(key))]);
      }
    }
  }

  const findings: LeakScanFinding[] = [];

  for (const { field, value } of targets) {
    let serialised: string;
    try {
      serialised = typeof value === "string" ? value : JSON.stringify(value) ?? "";
    } catch {
      findings.push({ location: field, pattern: "(serialisation error – value skipped)" });
      continue;
    }

    for (const [patternName, re] of patterns) {
      if (re.test(serialised)) {
        findings.push({ location: field, pattern: patternName });
      }
    }
  }

  return { ok: findings.length === 0, findings };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
