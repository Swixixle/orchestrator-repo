export type ProvenanceLabel = "SIGNED" | "DERIVED" | "UNSIGNED";

export interface NormalizedMasterReceipt {
  receipt_version?: string;
  receipt_id?: string;
  content_hash?: string;
  signature?: string;
  signed_payload?: string;
  metadata?: Record<string, unknown>;
  verification?: unknown;
  raw: Record<string, unknown>;
}

export interface EliAssertion {
  assertion_type: "FACT" | "INFERENCE" | "OTHER";
  text: string;
  confidence?: number;
  sources: string[];
}

export interface NormalizedEvidencePack {
  receipt_id?: string;
  content_hash?: string;
  transcript?: unknown;
  eli_assertions: EliAssertion[];
  commentary?: string;
  raw: Record<string, unknown>;
}

export interface NormalizedArtifact {
  master_receipt?: NormalizedMasterReceipt;
  evidence_pack?: NormalizedEvidencePack;
  warnings: string[];
}

export function normalizeArtifact(input: unknown): NormalizedArtifact {
  const warnings: string[] = [];
  const root = toRecord(input);
  if (!root) {
    return { warnings: ["Input is not a JSON object."] };
  }

  const nestedMaster = toRecord(root.master_receipt) ?? toRecord(root.haloReceipt);
  const nestedEvidence = toRecord(root.evidence_pack);

  const masterCandidate = nestedMaster ?? (looksLikeMasterReceipt(root) ? root : undefined);
  const evidenceCandidate =
    nestedEvidence ?? (looksLikeEvidencePack(root) ? root : undefined) ?? deriveEvidenceFromArtifact(root);

  const master_receipt = masterCandidate ? normalizeMasterReceipt(masterCandidate) : undefined;
  const evidence_pack = evidenceCandidate ? normalizeEvidencePack(evidenceCandidate) : undefined;

  if (!master_receipt && !evidence_pack) {
    warnings.push("Could not infer a master receipt or evidence pack from the uploaded JSON.");
  }

  if (master_receipt?.verification !== undefined) {
    warnings.push("Artifact includes verification fields; treat these as DERIVED and re-verify locally.");
  }

  return { master_receipt, evidence_pack, warnings };
}

function normalizeMasterReceipt(value: Record<string, unknown>): NormalizedMasterReceipt {
  const receipt_id = asString(value.receipt_id) ?? asString(value.id);
  const content_hash =
    asString(value.content_hash) ?? asString(value.transcript_hash) ?? asString(value.responseHash);

  const metadataFromValue = toRecord(value.metadata) ?? {};
  const metadata = {
    ...metadataFromValue,
    ...(asString(value.ts) ? { ts: value.ts } : {}),
    ...(asString(value.timestamp) ? { timestamp: value.timestamp } : {}),
    ...(asString(value.signature_alg) ? { signature_alg: value.signature_alg } : {}),
    ...(asString(value.public_key_id) ? { public_key_id: value.public_key_id } : {}),
    ...(asString(value.key_id) ? { key_id: value.key_id } : {}),
    ...(asString(value.public_key) ? { public_key: value.public_key } : {}),
  };

  return {
    receipt_version: asString(value.receipt_version) ?? asString(value.contract_version),
    receipt_id,
    content_hash,
    signature: asString(value.signature),
    signed_payload: asString(value.signed_payload),
    verification: value.verification,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    raw: value,
  };
}

function normalizeEvidencePack(value: Record<string, unknown>): NormalizedEvidencePack {
  const receipt_id = asString(value.receipt_id) ?? asString(value.id);
  const content_hash = asString(value.content_hash) ?? asString(value.transcript_hash);

  const transcript =
    value.transcript ??
    value.response ??
    (toRecord(value.provenance) ? value.provenance : undefined) ??
    undefined;

  const eli_assertions = extractAssertions(value);

  const commentaryValue =
    asString(value.commentary) ??
    asString(value.notes) ??
    asString(value.analysis) ??
    asString(value.summary);

  return {
    receipt_id,
    content_hash,
    transcript,
    eli_assertions,
    commentary: commentaryValue,
    raw: value,
  };
}

function deriveEvidenceFromArtifact(root: Record<string, unknown>): Record<string, unknown> | undefined {
  const transcript = root.transcript;
  const ledger = toRecord(root.eliLedger);
  const claims = Array.isArray(ledger?.claims) ? ledger?.claims : undefined;

  if (!transcript && !claims) {
    return undefined;
  }

  return {
    receipt_id: asString(root.receipt_id) ?? asString(toRecord(root.haloReceipt)?.id),
    content_hash:
      asString(root.content_hash) ??
      asString(toRecord(root.haloReceipt)?.transcript_hash) ??
      asString(toRecord(root.haloReceipt)?.responseHash),
    transcript,
    eli_assertions: claims,
    commentary: asString(root.commentary) ?? asString(root.notes),
  };
}

function extractAssertions(value: Record<string, unknown>): EliAssertion[] {
  const assertionsRaw =
    (Array.isArray(value.eli_assertions) ? value.eli_assertions : undefined) ??
    (Array.isArray(toRecord(value.eliLedger)?.claims) ? toRecord(value.eliLedger)?.claims : undefined) ??
    [];

  return assertionsRaw
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const rawType = asString(entry.assertion_type) ?? asString(entry.type) ?? "OTHER";
      const normalizedType = normalizeAssertionType(rawType);

      const sourcesRaw =
        (Array.isArray(entry.sources) ? entry.sources : undefined) ??
        (Array.isArray(entry.span_refs) ? entry.span_refs : undefined) ??
        [];

      const sources = sourcesRaw.map((source) => JSON.stringify(source));

      return {
        assertion_type: normalizedType,
        text: asString(entry.text) ?? asString(entry.claim) ?? "",
        confidence: typeof entry.confidence === "number" ? entry.confidence : undefined,
        sources,
      };
    });
}

function normalizeAssertionType(value: string): "FACT" | "INFERENCE" | "OTHER" {
  const upper = value.toUpperCase();
  if (upper === "FACT") return "FACT";
  if (upper === "INFERENCE") return "INFERENCE";
  return "OTHER";
}

function looksLikeMasterReceipt(value: Record<string, unknown>): boolean {
  return Boolean(
    asString(value.receipt_id) ||
      asString(value.id) ||
      asString(value.content_hash) ||
      asString(value.transcript_hash)
  );
}

function looksLikeEvidencePack(value: Record<string, unknown>): boolean {
  return Boolean(value.transcript || value.eli_assertions || toRecord(value.eliLedger)?.claims);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
