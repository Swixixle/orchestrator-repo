import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

const sampleDir = path.join(process.cwd(), "samples", "evidence-inspector");
fs.mkdirSync(sampleDir, { recursive: true });

const transcriptValid = {
  speaker: "assistant",
  text: "Ocean tides are driven primarily by the Moon and secondarily by the Sun.",
  turns: [
    { role: "user", content: "What causes tides?" },
    { role: "assistant", content: "Mainly lunar and solar gravity." },
  ],
};

const contentHashValid = crypto
  .createHash("sha256")
  .update(canonicalize(transcriptValid), "utf8")
  .digest("hex");
const receiptId = "sample-receipt-001";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

const signedEnvelopeObj = {
  content_hash: contentHashValid,
  metadata: {
    created_at: "2026-02-22T00:00:00.000Z",
    public_key: publicPem,
    purpose: "sample-artifact",
  },
  receipt_id: receiptId,
  receipt_version: "1.0.0",
};
const signed_payload = canonicalize(signedEnvelopeObj);
const signature = crypto.sign(null, Buffer.from(signed_payload, "utf8"), privateKey).toString("base64");

const masterValid = {
  receipt_version: "1.0.0",
  receipt_id: receiptId,
  content_hash: contentHashValid,
  signature,
  signed_payload,
  metadata: signedEnvelopeObj.metadata,
  verification: {
    status: "verified",
    note: "artifact-provided status only; UI should treat as DERIVED (artifact)",
  },
};

const evidenceValid = {
  receipt_id: receiptId,
  content_hash: contentHashValid,
  transcript: transcriptValid,
  eli_assertions: [
    {
      assertion_type: "FACT",
      text: "The Moon contributes the dominant tidal force on Earth.",
      confidence: 0.95,
      sources: ["turn:2"],
    },
    {
      assertion_type: "INFERENCE",
      text: "Coastal tide timing changes as the Moon’s relative position changes.",
      confidence: 0.76,
      sources: ["turn:2"],
    },
  ],
  commentary: "Analyst note: concise educational answer with no regional nuance.",
};

const evidenceTamperedTranscript = {
  ...evidenceValid,
  transcript: {
    ...transcriptValid,
    text: "Tides are caused mostly by ocean floor volcanoes.",
  },
};

const masterTamperedHash = {
  ...masterValid,
  content_hash: "0000000000000000000000000000000000000000000000000000000000000000",
};

const artifactCombined = {
  master_receipt: masterValid,
  evidence_pack: evidenceValid,
};

const artifactWithLeak = {
  master_receipt: masterValid,
  evidence_pack: {
    ...evidenceValid,
    commentary: "UNSIGNED NOTE: Authorization: Bearer sk-demo-leak-token-1234567890",
  },
};

const files = {
  "master_receipt.valid.json": masterValid,
  "evidence_pack.valid.json": evidenceValid,
  "evidence_pack.tampered_transcript.json": evidenceTamperedTranscript,
  "master_receipt.tampered_content_hash.json": masterTamperedHash,
  "artifact.valid.json": artifactCombined,
  "artifact.with_leak.json": artifactWithLeak,
};

for (const [name, obj] of Object.entries(files)) {
  fs.writeFileSync(path.join(sampleDir, name), `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

const readme = `# Evidence Inspector Samples

These files are designed for manual acceptance checks in the HALO Evidence Inspector.

## Files

- master_receipt.valid.json
- evidence_pack.valid.json
- evidence_pack.tampered_transcript.json
- master_receipt.tampered_content_hash.json
- artifact.valid.json
- artifact.with_leak.json

## Suggested checks

1. Load only master_receipt.valid.json -> Unverified (no evidence pack loaded).
2. Load master_receipt.valid.json + evidence_pack.valid.json -> Verified.
3. Load master_receipt.valid.json + evidence_pack.tampered_transcript.json -> Unverified (hash mismatch).
4. Load master_receipt.tampered_content_hash.json + evidence_pack.valid.json -> Unverified (hash mismatch).
5. Load artifact.with_leak.json -> leak warning visible and Share/Export disabled.
`;
fs.writeFileSync(path.join(sampleDir, "README.md"), readme, "utf8");

console.log(`Wrote samples to ${sampleDir}`);
