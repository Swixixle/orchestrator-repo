#!/usr/bin/env node

/**
 * Exported for test harness HMAC verification. Builds canonical transcript for HMAC.
 * Do NOT change logic or field order. Used for deterministic test/CLI alignment.
 */
export function canonicalizeValetTranscript(receipt: Record<string, unknown>): string {
  const transcript = normalizeValetToTranscript(receipt);
  return canonicalJson(transcript);
}
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as signDetached,
  verify as verifyDetached,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanForLeaks } from "../utils/leakScan.js";
import { tagResponseToLedger } from "../adapters/eliAdapter.js";
import logger, { logRequest } from "../../lib/logger.js";

const DOMAIN_PREFIX = "HALO_MASTER_RECEIPT_V1|";

type JsonRecord = Record<string, unknown>;

type HmacStrategy =
  | "canonical_transcript"
  | "canonical_receipt_without_signatures"
  | "transcript_hash_field";

interface ValetSourceFile {
  file: string;
  sha256: string;
}

interface MasterReceipt {
  receipt_version: string;
  receipt_id: string;
  content_hash: string;
  signature_scheme: "ed25519";
  signature: string;
  metadata: Record<string, unknown>;
  verification: {
    derived_status: "PASS" | "FAIL";
    verified_at: string;
    valet_hmac_strategy: HmacStrategy | "none";
    checks: string[];
  };
}

interface EvidencePack {
  receipt_id: string;
  content_hash: string;
  valet_source: {
    source_dir: string;
    files: ValetSourceFile[];
    source_receipt_file: string;
  };
  transcript: JsonRecord;
  eli_assertions: Array<{
    assertion_type: string;
    text: string;
    confidence?: number;
    sources: string[];
  }>;
  notes?: string;
}

interface ProtocolCheck {
  name: string;
  passed: boolean;
  detail: string;
}

interface ProtocolReport {
  status: "PASS" | "FAIL";
  generated_at: string;
  input_dir: string;
  output_dir: string;
  matched_hmac_strategy: HmacStrategy | "none";
  checks: ProtocolCheck[];
  leak_scan: {
    master_ok: boolean;
    master_findings: Array<{ location: string; pattern: string }>;
    evidence_ok: boolean;
    evidence_findings: Array<{ location: string; pattern: string }>;
  };
  submission?: {
    attempted: boolean;
    ok: boolean;
    endpoint: string;
    status?: number;
    detail: string;
  };
}

function printUsageAndExit(): never {

Options:
  --quiet, -q    Suppress progress and fail logs (for CI/scripts)
  --help,  -h    Show this usage message

Arguments:
  <valet-dist-dir>  Path to Valet output directory (required)

Environment:
  VALET_RECEIPT_HMAC_KEY   Required for HMAC verification
  RECEIPT_SIGNING_KEY      Required for Ed25519 checkpoint
  RECEIPT_VERIFY_KEY       Optional for offline verify

Example:
  ingestValet --quiet dist/my-valet-run
`);
  process.exit(0);
  logger.info({ msg: "Usage: ingestValet [--quiet|-q] <valet-dist-dir>\n\nOptions:\n  --quiet, -q    Suppress progress and fail logs (for CI/scripts)\n  --help,  -h    Show this usage message\n\nArguments:\n  <valet-dist-dir>  Path to Valet output directory (required)\n\nEnvironment:\n  VALET_RECEIPT_HMAC_KEY   Required for HMAC verification\n  RECEIPT_SIGNING_KEY      Required for Ed25519 checkpoint\n  RECEIPT_VERIFY_KEY       Optional for offline verify\n\nExample:\n  ingestValet --quiet dist/my-valet-run" });
  process.exit(0);
}

interface IngestArgs {
  inputDir: string;
  quiet: boolean;
}

interface RunIngestOptions {
  quiet?: boolean;
}

interface HmacVerifyResult {
  ok: boolean;
  strategy: HmacStrategy | "none";
  reason?: string;
}

interface SubmissionResult {
  attempted: boolean;
  ok: boolean;
  endpoint: string;
  status?: number;
  responseBody?: unknown;
  detail: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as JsonRecord;
    const keys = Object.keys(record).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function parseIngestArgs(argv: string[]): IngestArgs {
  const args = argv.slice(2).filter((value) => value.trim().length > 0);
  if (args.includes("--help") || args.includes("-h")) {
    printUsageAndExit();
  }
  function printUsageAndExit(): never {
    console.log(`\nUsage: ingestValet [--quiet|-q] <valet-dist-dir>

  Options:
    --quiet, -q    Suppress progress and fail logs (for CI/scripts)
    --help,  -h    Show this usage message

  Arguments:
    <valet-dist-dir>  Path to Valet output directory (required)

  Environment:
    VALET_RECEIPT_HMAC_KEY   Required for HMAC verification
    RECEIPT_SIGNING_KEY      Required for Ed25519 checkpoint
    RECEIPT_VERIFY_KEY       Optional for offline verify

  Example:
    ingestValet --quiet dist/my-valet-run
  `);
    process.exit(0);
  }
  let quiet = false;
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === "--quiet" || arg === "-q") {
      quiet = true;
      continue;
    }
    positionals.push(arg);
  }

  const firstPositional = positionals.find((value) => !value.startsWith("-"));
  if (!firstPositional) {
    console.error("[ERROR] Missing required <valet-dist-dir> argument.");
    printUsageAndExit();
  }
  return { inputDir: resolve(firstPositional), quiet };
}

export function normalizeValetToTranscript(receipt: JsonRecord): JsonRecord {
  const directMessages = asMessageArray(receipt.messages);
  const transcriptMessages = asMessageArray(asRecord(receipt.transcript)?.messages);
  const conversationMessages = asMessageArray(receipt.conversation);

  const prompt =
    asString(receipt.prompt) ??
    asString(receipt.input) ??
    asString(asRecord(receipt.request)?.prompt) ??
    asString(asRecord(receipt.request)?.input);

  const completion =
    asString(receipt.completion) ??
    asString(receipt.output) ??
    asString(asRecord(receipt.response)?.text) ??
    asString(asRecord(receipt.response)?.output_text) ??
    asString(asRecord(receipt.result)?.text);

  let messages = directMessages ?? transcriptMessages ?? conversationMessages;
  if (!messages || messages.length === 0) {
    const synthesized: Array<{ role: string; content: string }> = [];
    if (prompt) synthesized.push({ role: "user", content: prompt });
    if (completion) synthesized.push({ role: "assistant", content: completion });
    messages = synthesized;
  }

  const transcript: JsonRecord = {
    messages,
    model:
      asString(receipt.model) ??
      asString(asRecord(receipt.request)?.model) ??
      asString(asRecord(receipt.response)?.model) ??
      "unknown",
    created_at:
      asString(receipt.created_at) ??
      asString(receipt.timestamp) ??
      asString(asRecord(receipt.response)?.created_at) ??
      "unknown",
  };

  const inputs =
    asRecord(receipt.inputs) ??
    asRecord(receipt.request) ??
    asRecord(asRecord(receipt.transcript)?.inputs);
  if (inputs) {
    transcript.inputs = inputs;
  }

  return transcript;
}

export function verifyValetHmac(receipt: JsonRecord, hmacKey: string): HmacVerifyResult {
    function dumpStringDiagnostics(label: string, s: string) {
      const raw = s;
      const norm = s.trim().toLowerCase();
      const toHexBytes = (str: string) => Buffer.from(str, "utf8").toString("hex");
      const codepoints = Array.from(raw).map((ch) => ch.codePointAt(0)?.toString(16));
      logger.debug({ msg: `[DEBUG] ===== ${label} =====` });
      logger.debug({ msg: `[DEBUG] raw.length=${raw.length} norm.length=${norm.length}` });
      logger.debug({ msg: `[DEBUG] raw(JSON)=${JSON.stringify(raw)}` });
      logger.debug({ msg: `[DEBUG] norm(JSON)=${JSON.stringify(norm)}` });
      logger.debug({ msg: `[DEBUG] raw_utf8_hex=${toHexBytes(raw)}` });
      logger.debug({ msg: `[DEBUG] norm_utf8_hex=${toHexBytes(norm)}` });
      logger.debug({ msg: `[DEBUG] codepoints(hex)=${codepoints.join(" ")}` });
    }

    function firstDiffIndex(a: string, b: string) {
      const A = a.trim().toLowerCase();
      const B = b.trim().toLowerCase();
      const n = Math.min(A.length, B.length);
      for (let i = 0; i < n; i++) {
        if (A[i] !== B[i]) return i;
      }
      if (A.length !== B.length) return n;
      return -1;
    }
  const extractedSignature = readValetSignature(receipt);
  const signatureType = asString(receipt.signature_type);
  if (process.env.DEBUG_VALET_HMAC === "1") {
    logger.debug({ msg: "[DEBUG] extracted_signature", extractedSignature });
    logger.debug({ msg: "[DEBUG] signature_type", signatureType });
    logger.debug({ msg: "[DEBUG] extracted_signature_length", length: extractedSignature?.length });
  }
  if (!extractedSignature) {
    return { ok: false, strategy: "none", reason: "No Valet HMAC signature field found." };
  }

  const transcript = normalizeValetToTranscript(receipt);
  const canonicalTranscript = canonicalJson(transcript);
  const canonicalReceipt = canonicalJson(stripSignatureFields(receipt));
  const transcriptHashField =
    asString(receipt.transcript_hash) ??
    asString(receipt.content_hash) ??
    asString(asRecord(receipt.verification)?.transcript_hash);

  const candidates: Array<{ strategy: HmacStrategy; payload: string }> = [
    { strategy: "canonical_transcript", payload: canonicalTranscript },
    { strategy: "canonical_receipt_without_signatures", payload: canonicalReceipt },
  ];
  if (transcriptHashField) {
    candidates.push({ strategy: "transcript_hash_field", payload: transcriptHashField });
  }

  let matchedStrategy: HmacStrategy | "none" = "none";
  for (const candidate of candidates) {
    const payloadVariantName = candidate.strategy;
    const computedHmac = createHmac("sha256", hmacKey).update(candidate.payload, "utf8").digest("hex");
    if (process.env.DEBUG_VALET_HMAC === "1") {
      logger.debug({ msg: "[DEBUG] candidate_payload", payloadVariantName });
      logger.debug({ msg: "[DEBUG] canonical_transcript", canonicalTranscript });
      logger.debug({ msg: "[DEBUG] computed_hmac_hex", computedHmac });
      dumpStringDiagnostics("extracted_signature", extractedSignature);
      dumpStringDiagnostics("computed_hmac_hex", computedHmac);
      const i = firstDiffIndex(extractedSignature, computedHmac);
      logger.debug({ msg: "[DEBUG] first_diff_index", i });
      if (i !== -1) {
        const A = extractedSignature.trim().toLowerCase();
        const B = computedHmac.trim().toLowerCase();
        logger.debug({ msg: "[DEBUG] A[i],B[i]", A: A[i], B: B[i] });
        logger.debug({ msg: "[DEBUG] A_slice", slice: JSON.stringify(A.slice(Math.max(0,i-8), i+8)) });
        logger.debug({ msg: "[DEBUG] B_slice", slice: JSON.stringify(B.slice(Math.max(0,i-8), i+8)) });
      }
      // Also log transcript bytes
      const transcriptNorm = candidate.payload;
      logger.debug({ msg: "[DEBUG] transcript.length", length: transcriptNorm.length });
      logger.debug({ msg: "[DEBUG] transcript(JSON)", transcript: JSON.stringify(transcriptNorm) });
      logger.debug({ msg: "[DEBUG] transcript_utf8_hex", hex: Buffer.from(transcriptNorm, "utf8").toString("hex") });
    }
    const normalize = (s: string) => s.trim().toLowerCase();
    if (normalize(computedHmac) === normalize(extractedSignature)) {
      matchedStrategy = candidate.strategy;
      if (process.env.DEBUG_VALET_HMAC === "1") {
        logger.debug({ msg: "[DEBUG] matched_strategy", matchedStrategy });
      }
      break;
    }
  }

  if (matchedStrategy !== "none") {
    return { ok: true, strategy: matchedStrategy };
  }
  if (process.env.DEBUG_VALET_HMAC === "1") {
    console.log("[DEBUG] matched_strategy:", matchedStrategy);
  }
  return {
    ok: false,
    strategy: "none",
    reason: "No HMAC verification strategy matched this receipt signature.",
  };
}

export function createMasterReceipt(input: {
  transcript: JsonRecord;
  sourceDir: string;
  sourceReceiptFile: string;
  sourceFiles: ValetSourceFile[];
  matchedHmacStrategy: HmacStrategy;
  signingKeyPem: string;
}): { master_receipt: MasterReceipt; evidence_pack: EvidencePack } {
  const canonicalTranscript = canonicalJson(input.transcript);
  const contentHash = sha256Hex(canonicalTranscript);
  const receiptId = randomUUID();

  const envelope = {
    receipt_version: "halo.master.v1",
    receipt_id: receiptId,
    content_hash: contentHash,
    signature_scheme: "ed25519",
  };
  const envelopePayload = DOMAIN_PREFIX + canonicalJson(envelope);

  const privateKey = createPrivateKey(normalizePem(input.signingKeyPem));
  const signature = signDetached(null, Buffer.from(envelopePayload, "utf8"), privateKey).toString("base64");

  const assistantText = extractAssistantText(input.transcript);
  const ledger = assistantText ? tagResponseToLedger(assistantText) : { claims: [] };

  const evidence_pack: EvidencePack = {
    receipt_id: receiptId,
    content_hash: contentHash,
    valet_source: {
      source_dir: input.sourceDir,
      files: input.sourceFiles,
      source_receipt_file: input.sourceReceiptFile,
    },
    transcript: input.transcript,
    eli_assertions: (ledger.claims ?? []).map((claim) => ({
      assertion_type: claim.type,
      text: claim.text,
      sources: (claim.span_refs ?? []).map((span) => JSON.stringify(span)),
      confidence: undefined,
    })),
    notes: "Sensitive evidence pack. Do not share externally without policy review.",
  };

  const master_receipt: MasterReceipt = {
    receipt_version: envelope.receipt_version,
    receipt_id: receiptId,
    content_hash: contentHash,
    signature_scheme: "ed25519",
    signature,
    metadata: {
      source: "valet-ingest-bridge",
      ingested_at: new Date().toISOString(),
      source_dir: input.sourceDir,
      source_receipt_file: input.sourceReceiptFile,
    },
    verification: {
      derived_status: "PASS",
      verified_at: new Date().toISOString(),
      valet_hmac_strategy: input.matchedHmacStrategy,
      checks: ["valet_hmac_verified", "content_hash_computed", "ed25519_checkpoint_generated"],
    },
  };

  return { master_receipt, evidence_pack };
}

export function verifyCheckpointOffline(input: {
  masterReceipt: MasterReceipt;
  evidencePack: EvidencePack;
  verifyKeyPem?: string;
  signingKeyPem?: string;
}): { ok: boolean; reason?: string } {
  const canonicalTranscript = canonicalJson(input.evidencePack.transcript);
  const expectedHash = sha256Hex(canonicalTranscript);

  if (expectedHash !== input.masterReceipt.content_hash) {
    return { ok: false, reason: "content_hash mismatch between master receipt and evidence transcript" };
  }

  if (input.evidencePack.content_hash !== input.masterReceipt.content_hash) {
    return { ok: false, reason: "evidence_pack.content_hash mismatch with master receipt" };
  }

  const envelope = {
    receipt_version: input.masterReceipt.receipt_version,
    receipt_id: input.masterReceipt.receipt_id,
    content_hash: input.masterReceipt.content_hash,
    signature_scheme: input.masterReceipt.signature_scheme,
  };
  const payload = Buffer.from(DOMAIN_PREFIX + canonicalJson(envelope), "utf8");

  const publicKeyPem =
    input.verifyKeyPem ??
    derivePublicKeyPemFromPrivate(input.signingKeyPem) ??
    asString(input.masterReceipt.metadata?.public_key);

  if (!publicKeyPem) {
    return { ok: false, reason: "missing verify key (RECEIPT_VERIFY_KEY) for Ed25519 verification" };
  }

  const publicKey = createPublicKey(normalizePem(publicKeyPem));
  const ok = verifyDetached(
    null,
    payload,
    publicKey,
    Buffer.from(input.masterReceipt.signature, "base64")
  );

  return ok ? { ok: true } : { ok: false, reason: "ed25519 signature verification failed" };
}

export async function runIngestValet(argv: string[], options?: RunIngestOptions): Promise<boolean> {
  const parsed = parseIngestArgs(argv);
  const quiet = options?.quiet ?? parsed.quiet;
  const { inputDir } = parsed;
  ensureDirectory(inputDir);

  const sourceFiles = collectSourceFiles(inputDir);
  const receiptFile = pickReceiptFile(sourceFiles);
  if (!receiptFile) {
    console.error("[ERROR] No Valet receipt JSON found. Expected receipt.json or receipt*.json in input directory.");
    return false;
  }

  const receiptPath = join(inputDir, receiptFile.file);
  const receiptJson = readJsonObject(receiptPath);

  const checks: ProtocolCheck[] = [];
  const hmacKey = process.env.VALET_RECEIPT_HMAC_KEY;
  if (!hmacKey) {
    console.error("[ERROR] VALET_RECEIPT_HMAC_KEY is required for HMAC verification phase.");
    return false;
  }

  const hmacResult = verifyValetHmac(receiptJson, hmacKey);
  checks.push({
    name: "valet_hmac_verification",
    passed: hmacResult.ok,
    detail: hmacResult.ok
      ? `Matched strategy: ${hmacResult.strategy}`
      : `Failed: ${hmacResult.reason ?? "unknown"}`,
  });

  if (!hmacResult.ok || hmacResult.strategy === "none") {
    console.error("[ERROR] Valet HMAC verification failed.");
    return false;
  }

  // HALO checkpoint generation phase
  const signingKey = process.env.RECEIPT_SIGNING_KEY;
  if (!signingKey) {
    console.error("[ERROR] RECEIPT_SIGNING_KEY (Ed25519 private key PEM) is required for HALO checkpoint generation phase.");
    return false;
  }

  const transcript = normalizeValetToTranscript(receiptJson);

  const outputDir = join(inputDir, "halo_checkpoint");
  mkdirSync(outputDir, { recursive: true });

  const { master_receipt, evidence_pack } = createMasterReceipt({
    transcript,
    sourceDir: inputDir,
    sourceReceiptFile: receiptFile.file,
    sourceFiles,
    matchedHmacStrategy: hmacResult.strategy,
    signingKeyPem: signingKey,
  });

  checks.push({
    name: "content_hash_computed",
    passed: true,
    detail: `content_hash=${master_receipt.content_hash}`,
  });
  checks.push({
    name: "ed25519_checkpoint_generated",
    passed: true,
    detail: `receipt_id=${master_receipt.receipt_id}`,
  });

  const masterNoPlaintext = assertMasterHasNoPlaintext(master_receipt);
  checks.push({
    name: "master_receipt_plaintext_check",
    passed: masterNoPlaintext.ok,
    detail: masterNoPlaintext.ok ? "No transcript/plaintext fields in master receipt." : masterNoPlaintext.reason,
  });

  const masterLeakScan = scanForLeaks([{ field: "master_receipt", value: master_receipt }], [
    process.env.OPENAI_API_KEY,
    process.env.VALET_RECEIPT_HMAC_KEY,
    process.env.RECEIPT_SIGNING_KEY,
  ].filter((v): v is string => typeof v === "string" && v.length > 0));

  const evidenceLeakScan = scanForLeaks([{ field: "evidence_pack", value: evidence_pack }], [
    process.env.OPENAI_API_KEY,
    process.env.VALET_RECEIPT_HMAC_KEY,
    process.env.RECEIPT_SIGNING_KEY,
  ].filter((v): v is string => typeof v === "string" && v.length > 0));

  checks.push({
    name: "master_receipt_leak_scan",
    passed: masterLeakScan.ok,
    detail: masterLeakScan.ok
      ? "No leak patterns in master receipt."
      : masterLeakScan.findings.map((f) => `${f.location}: ${f.pattern}`).join("; "),
  });

  checks.push({
    name: "evidence_pack_leak_scan",
    passed: true,
    detail: evidenceLeakScan.ok
      ? "No leak patterns detected."
      : `Warning only: ${evidenceLeakScan.findings.map((f) => `${f.location}: ${f.pattern}`).join("; ")}`,
  });

  const verifyResult = verifyCheckpointOffline({
    masterReceipt: master_receipt,
    evidencePack: evidence_pack,
    verifyKeyPem: process.env.RECEIPT_VERIFY_KEY,
    signingKeyPem: signingKey,
  });
  checks.push({
    name: "offline_verify",
    passed: verifyResult.ok,
    detail: verifyResult.ok ? "Offline hash + Ed25519 verification passed." : verifyResult.reason ?? "verification failed",
  });

  const tamperedEvidence = structuredClone(evidence_pack);
  tamperedEvidence.transcript = { ...(asRecord(tamperedEvidence.transcript) ?? {}), __tampered: true };
  const tamperedEvidenceVerify = verifyCheckpointOffline({
    masterReceipt: master_receipt,
    evidencePack: tamperedEvidence,
    verifyKeyPem: process.env.RECEIPT_VERIFY_KEY,
    signingKeyPem: signingKey,
  });
  checks.push({
    name: "acceptance_tampered_evidence_fails",
    passed: !tamperedEvidenceVerify.ok,
    detail: !tamperedEvidenceVerify.ok
      ? tamperedEvidenceVerify.reason ?? "tampered evidence failed as expected"
      : "tampered evidence unexpectedly verified",
  });

  const tamperedMaster = structuredClone(master_receipt);
  tamperedMaster.content_hash = flipHexChar(master_receipt.content_hash);
  const tamperedMasterVerify = verifyCheckpointOffline({
    masterReceipt: tamperedMaster,
    evidencePack: evidence_pack,
    verifyKeyPem: process.env.RECEIPT_VERIFY_KEY,
    signingKeyPem: signingKey,
  });
  checks.push({
    name: "acceptance_tampered_master_fails",
    passed: !tamperedMasterVerify.ok,
    detail: !tamperedMasterVerify.ok
      ? tamperedMasterVerify.reason ?? "tampered master failed as expected"
      : "tampered master unexpectedly verified",
  });

  writeFileSync(join(outputDir, "master_receipt.json"), `${JSON.stringify(master_receipt, null, 2)}\n`, "utf8");
  writeFileSync(join(outputDir, "evidence_pack.json"), `${JSON.stringify(evidence_pack, null, 2)}\n`, "utf8");

  const submission = await maybeSubmitToLedger(master_receipt, evidence_pack);
  if (submission.attempted) {
    writeFileSync(
      join(outputDir, "ledger_submission.json"),
      `${JSON.stringify(
        {
          endpoint: submission.endpoint,
          ok: submission.ok,
          status: submission.status,
          detail: submission.detail,
          response: submission.responseBody,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    checks.push({
      name: "ledger_submission",
      passed: submission.ok,
      detail: submission.detail,
    });
  }

  return finalizeRun({
    checks,
    inputDir,
    outputDir,
    matchedHmacStrategy: hmacResult.strategy,
    masterLeakScan,
    evidenceLeakScan,
    submission,
    quiet,
  });
}

function finalizeRun(input: {
  checks: ProtocolCheck[];
  inputDir: string;
  outputDir: string;
  matchedHmacStrategy: HmacStrategy | "none";
  masterLeakScan: { ok: boolean; findings: Array<{ location: string; pattern: string }> };
  evidenceLeakScan: { ok: boolean; findings: Array<{ location: string; pattern: string }> };
  submission?: SubmissionResult;
  quiet?: boolean;
}): boolean {
  const overallPass = input.checks.every((check) => check.passed);

  const report: ProtocolReport = {
    status: overallPass ? "PASS" : "FAIL",
    generated_at: new Date().toISOString(),
    input_dir: input.inputDir,
    output_dir: input.outputDir,
    matched_hmac_strategy: input.matchedHmacStrategy,
    checks: input.checks,
    leak_scan: {
      master_ok: input.masterLeakScan.ok,
      master_findings: input.masterLeakScan.findings,
      evidence_ok: input.evidenceLeakScan.ok,
      evidence_findings: input.evidenceLeakScan.findings,
    },
    submission: input.submission
      ? {
          attempted: input.submission.attempted,
          ok: input.submission.ok,
          endpoint: input.submission.endpoint,
          status: input.submission.status,
          detail: input.submission.detail,
        }
      : undefined,
  };

  mkdirSync(input.outputDir, { recursive: true });
  writeFileSync(join(input.outputDir, "protocol_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const byName = new Map(input.checks.map((check) => [check.name, check]));
  if (!input.quiet) {
    printCheck(byName.get("valet_hmac_verification"), "Valet HMAC verified");
    printCheck(byName.get("content_hash_computed"), "Canonical content_hash computed");
    printCheck(byName.get("ed25519_checkpoint_generated"), "Ed25519 checkpoint generated");
    printCheck(byName.get("offline_verify"), "Offline verify OK");

    logger.info({ msg: "matched_hmac_strategy", matchedHmacStrategy: input.matchedHmacStrategy });
    logger.info({ msg: "output", outputDir: input.outputDir });
    logger.info({ msg: "protocol_report", protocolReport: join(input.outputDir, "protocol_report.json") });
  }

  return overallPass;
}

function printCheck(check: ProtocolCheck | undefined, title: string): void {
  if (!check) {
    logger.error({ msg: `[FAIL] ${title}: check missing` });
    return;
  }
  logger.info({ msg: `${check.passed ? "[PASS]" : "[FAIL]"} ${title}${check.detail ? ` (${check.detail})` : ""}` });
}

function ensureDirectory(dirPath: string): void {
  const st = statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) {
    throw new Error(`Input path is not a directory: ${dirPath}`);
  }
}

function collectSourceFiles(dirPath: string): ValetSourceFile[] {
  const fileNames = readdirSync(dirPath);
  return fileNames
    .filter((fileName) => statSync(join(dirPath, fileName)).isFile())
    .map((fileName) => {
      const content = readFileSync(join(dirPath, fileName));
      return {
        file: fileName,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function pickReceiptFile(files: ValetSourceFile[]): ValetSourceFile | undefined {
  const exact = files.find((file) => file.file.toLowerCase() === "receipt.json");
  if (exact) return exact;

  const candidates = files.filter((file) => /^receipt.*\.json$/i.test(file.file));
  const nonGenerated = candidates.filter(
    (file) => !file.file.startsWith("master_receipt") && !file.file.startsWith("ledger_submission")
  );

  return nonGenerated[0] ?? candidates[0];
}

function readJsonObject(filePath: string): JsonRecord {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed as JsonRecord;
}

function readValetSignature(receipt: JsonRecord): string | undefined {
  const directSignature = asString(receipt.signature);
  const directHmac = asString(receipt.hmac);
  const receiptSignature = asString(receipt.receipt_signature);
  const verification = asRecord(receipt.verification);

  return (
    directHmac ??
    (directSignature && (asString(receipt.signature_type)?.toLowerCase().includes("hmac") ?? true)
      ? directSignature
      : undefined) ??
    receiptSignature ??
    asString(verification?.hmac) ??
    asString(verification?.signature)
  );
}

function stripSignatureFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripSignatureFields(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as JsonRecord;
  const out: JsonRecord = {};

  for (const [key, val] of Object.entries(record)) {
    if (
      key === "signature" ||
      key === "hmac" ||
      key === "receipt_signature" ||
      key === "signature_type"
    ) {
      continue;
    }
    out[key] = stripSignatureFields(val);
  }

  return out;
}

function safeSignatureCompare(actual: string, expected: string): boolean {
  const normalizedActual = actual.replace(/\s+/g, "").trim();
  const normalizedExpected = expected.replace(/\s+/g, "").trim();

  const a = Buffer.from(normalizedActual, "utf8");
  const b = Buffer.from(normalizedExpected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asMessageArray(value: unknown): Array<{ role: string; content: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => {
      const role =
        asString(entry.role) ?? asString(entry.speaker) ?? asString(entry.author) ?? "assistant";
      const content =
        asString(entry.content) ?? asString(entry.text) ?? asString(entry.message) ?? "";
      return { role, content };
    })
    .filter((entry) => entry.content.length > 0);

  return items.length > 0 ? items : undefined;
}

function extractAssistantText(transcript: JsonRecord): string {
  const messages = asMessageArray(transcript.messages) ?? [];
  return messages
    .filter((message) => message.role.toLowerCase() === "assistant")
    .map((message) => message.content)
    .join("\n");
}

function normalizePem(rawPem: string): string {
  return rawPem.includes("\\n") ? rawPem.replace(/\\n/g, "\n") : rawPem;
}

function derivePublicKeyPemFromPrivate(privateKeyPem?: string): string | undefined {
  if (!privateKeyPem) return undefined;
  try {
    const privateKey = createPrivateKey(normalizePem(privateKeyPem));
    return createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  } catch {
    return undefined;
  }
}

function flipHexChar(input: string): string {
  if (input.length === 0) return "0";
  const first = input[0].toLowerCase();
  const replacement = first === "0" ? "1" : "0";
  return replacement + input.slice(1);
}

function assertMasterHasNoPlaintext(masterReceipt: MasterReceipt): { ok: boolean; reason: string } {
  const disallowedKeys = new Set([
    "transcript",
    "messages",
    "prompt",
    "completion",
    "response",
    "output_text",
    "raw_response",
  ]);

  const stack: unknown[] = [masterReceipt as unknown];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    for (const [key, value] of Object.entries(current as JsonRecord)) {
      if (disallowedKeys.has(key)) {
        return { ok: false, reason: `Disallowed plaintext key found in master receipt: ${key}` };
      }
      stack.push(value);
    }
  }

  return { ok: true, reason: "OK" };
}

async function maybeSubmitToLedger(
  masterReceipt: MasterReceipt,
  evidencePack: EvidencePack
): Promise<SubmissionResult> {
  const baseUrl = process.env.HALO_LEDGER_URL;
  if (!baseUrl) {
    return {
      attempted: false,
      ok: false,
      endpoint: "",
      detail: "Ledger submission skipped (HALO_LEDGER_URL not configured).",
    };
  }

  const endpointPath = process.env.HALO_INGEST_ENDPOINT ?? "/api/receipts/ingest";
  const endpoint = new URL(endpointPath, baseUrl).toString();

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (process.env.HALO_API_TOKEN) {
    headers.authorization = `Bearer ${process.env.HALO_API_TOKEN}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ master_receipt: masterReceipt, evidence_pack: evidencePack }),
    });

    const responseText = await response.text();
    const responseBody = tryParseJson(responseText);

    return {
      attempted: true,
      ok: response.ok,
      endpoint,
      status: response.status,
      responseBody,
      detail: response.ok
        ? `Ledger submission succeeded (${response.status}).`
        : `Ledger submission failed (${response.status}).`,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      endpoint,
      detail: `Ledger submission threw error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function tryParseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return { raw: input };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsageAndExit();
  }
  runIngestValet(process.argv)
    .then((ok) => {
      // Deep exit diagnostics
      logger.debug({ msg: "exiting_with_code", code: ok ? 0 : 1 });
      logger.debug({ msg: "verification_success", ok });
      process.exit(ok ? 0 : 1);
    })
    .catch((error: unknown) => {
      logger.error({ msg: "[ingest-valet] ERROR", error: error instanceof Error ? error.message : error });
      logger.debug({ msg: "exiting_with_code", code: 1 });
      process.exit(1);
    });
}
