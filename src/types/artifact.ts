/**
 * Artifact – stable "truth object" written by the demo CLI and consumed by
 * the verify CLI.
 *
 * Design constraints
 * ------------------
 * NEVER include API keys or Authorization headers in any field.
 * Only include what can be proven from the public request/response:
 *   - exact request payload (model, parameters, messages)
 *   - model identifier as returned by the API
 *   - full LLM response text
 *   - HALO receipt and the transcript that was signed
 *   - ELI ledger and semantic validation result
 *   - provenance hash (if returned by halo-receipts)
 *   - credential leak scan result
 */

import type { EliLedger } from "../eli/tagger.js";
import type { EliValidationResult } from "../adapters/eliAdapter.js";

// ── Meta ─────────────────────────────────────────────────────────────────────

export interface ArtifactMeta {
  /** ISO-8601 timestamp when the artifact was produced */
  timestamp: string;
  /** Value of `version` from package.json */
  orchestratorVersion: string;
  /** process.version at artifact creation time */
  nodeVersion: string;
}

// ── LLM ──────────────────────────────────────────────────────────────────────

export interface ArtifactLLM {
  /** Provider name (e.g. "openai") */
  provider: string;
  /** API endpoint path used (e.g. "/chat/completions") */
  endpoint: string;
  /** Model string provided to the API */
  model: string;
  /**
   * Request parameters that were sent to the API and can be proven.
   * Does NOT include Authorization headers or API keys.
   */
  requestParams: Record<string, unknown>;
}

// ── Provenance ────────────────────────────────────────────────────────────────

export interface ArtifactProvenance {
  /** SHA-256 hex provenance hash returned by halo-receipts, if present */
  provenanceHash?: string;
  /** Raw provenance object returned by halo-receipts */
  raw?: Record<string, unknown>;
}

// ── Security ──────────────────────────────────────────────────────────────────

export interface LeakScanFinding {
  /** Human-readable description of what was found and where */
  location: string;
  /** The pattern that matched (e.g. "Bearer ") */
  pattern: string;
}

export interface LeakScanResult {
  /** true when no credential patterns were found */
  ok: boolean;
  findings: LeakScanFinding[];
}

// ── Root Artifact ─────────────────────────────────────────────────────────────

export interface Artifact {
  meta: ArtifactMeta;
  llm: ArtifactLLM;
  /**
   * The exact transcript object that was signed by halo-receipts.
   * Capturing this enables offline re-verification.
   */
  transcript: unknown;
  /** Receipt envelope returned by halo-receipts after signing */
  haloReceipt: unknown;
  provenance: ArtifactProvenance;
  eliLedger: EliLedger;
  eliValidation: EliValidationResult;
  security: {
    credentialLeakScan: LeakScanResult;
  };
}
