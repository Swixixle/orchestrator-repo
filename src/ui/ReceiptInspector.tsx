import { useMemo, useState, type ChangeEvent } from "react";
import { scanForLeaks } from "../utils/leakScan.js";
import { recomputeVerification, type LocalVerificationResult } from "./localVerification.js";
import {
  normalizeArtifact,
  type NormalizedArtifact,
  type NormalizedEvidencePack,
  type NormalizedMasterReceipt,
  type ProvenanceLabel,
} from "./normalizeArtifact.js";

type UploadedKind = "master" | "evidence" | "artifact";

interface LoadedPayload {
  name: string;
  raw: unknown;
  normalized: NormalizedArtifact;
}

const DEFAULT_VERIFICATION: LocalVerificationResult = {
  canRecomputeHash: false,
  hashMatches: false,
  hashReason: "Cannot recompute (no artifacts loaded).",
  signatureChecked: false,
  signatureValid: false,
  signatureReason: "Signature not verifiable (missing data).",
  isVerified: false,
};

export function ReceiptInspector(): JSX.Element {
  const [masterUpload, setMasterUpload] = useState<LoadedPayload | null>(null);
  const [evidenceUpload, setEvidenceUpload] = useState<LoadedPayload | null>(null);
  const [artifactUpload, setArtifactUpload] = useState<LoadedPayload | null>(null);
  const [localVerification, setLocalVerification] = useState<LocalVerificationResult>(
    DEFAULT_VERIFICATION
  );

  const effectiveMaster: NormalizedMasterReceipt | undefined =
    masterUpload?.normalized.master_receipt ?? artifactUpload?.normalized.master_receipt;
  const effectiveEvidence: NormalizedEvidencePack | undefined =
    evidenceUpload?.normalized.evidence_pack ?? artifactUpload?.normalized.evidence_pack;

  const warnings = useMemo(() => {
    const output: string[] = [];

    if (masterUpload && artifactUpload) {
      output.push("Using standalone master receipt over artifact master_receipt.");
    }
    if (evidenceUpload && artifactUpload) {
      output.push("Using standalone evidence pack over artifact evidence_pack.");
    }

    const allWarnings = [
      ...(masterUpload?.normalized.warnings ?? []),
      ...(evidenceUpload?.normalized.warnings ?? []),
      ...(artifactUpload?.normalized.warnings ?? []),
    ];

    output.push(...allWarnings);

    if (effectiveMaster && effectiveEvidence) {
      if (
        effectiveMaster.receipt_id &&
        effectiveEvidence.receipt_id &&
        effectiveMaster.receipt_id !== effectiveEvidence.receipt_id
      ) {
        output.push("Mismatch: receipt_id differs between master receipt and evidence pack.");
      }

      if (
        effectiveMaster.content_hash &&
        effectiveEvidence.content_hash &&
        effectiveMaster.content_hash !== effectiveEvidence.content_hash
      ) {
        output.push("Mismatch: content_hash differs between master receipt and evidence pack.");
      }
    }

    return output;
  }, [artifactUpload, effectiveEvidence, effectiveMaster, evidenceUpload, masterUpload]);

  const leakResult = useMemo(() => {
    const targets = [
      masterUpload ? { field: "master_receipt", value: masterUpload.raw } : undefined,
      evidenceUpload ? { field: "evidence_pack", value: evidenceUpload.raw } : undefined,
      artifactUpload ? { field: "artifact", value: artifactUpload.raw } : undefined,
    ].filter((value): value is { field: string; value: unknown } => Boolean(value));

    if (targets.length === 0) {
      return { ok: true, findings: [] as Array<{ location: string; pattern: string }> };
    }

    return scanForLeaks(targets, [
      envString("VITE_OPENAI_API_KEY"),
      envString("VITE_RECEIPT_SIGNING_KEY"),
      envString("VITE_RECEIPT_VERIFY_KEY"),
    ].filter((value): value is string => Boolean(value)));
  }, [artifactUpload, evidenceUpload, masterUpload]);

  async function handleFile(kind: UploadedKind, file: File): Promise<void> {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    const normalized = normalizeArtifact(parsed);

    const payload: LoadedPayload = {
      name: file.name,
      raw: parsed,
      normalized,
    };

    if (kind === "master") setMasterUpload(payload);
    if (kind === "evidence") setEvidenceUpload(payload);
    if (kind === "artifact") setArtifactUpload(payload);

    const nextMaster =
      kind === "master"
        ? normalized.master_receipt
        : kind === "artifact"
          ? normalized.master_receipt
          : effectiveMaster;

    const nextEvidence =
      kind === "evidence"
        ? normalized.evidence_pack
        : kind === "artifact"
          ? normalized.evidence_pack
          : effectiveEvidence;

    const result = await recomputeVerification(nextMaster, nextEvidence, {
      publicKeyPem: envString("VITE_RECEIPT_VERIFY_KEY"),
    });
    setLocalVerification(result);
  }

  const contentHash = effectiveMaster?.content_hash;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      <h1>HALO Evidence Inspector</h1>

      <section>
        <h2>Load artifacts</h2>
        <label>
          master_receipt.json
          <input type="file" accept="application/json" onChange={(event) => onPick(event, "master", handleFile)} />
        </label>
        <br />
        <label>
          evidence_pack.json
          <input type="file" accept="application/json" onChange={(event) => onPick(event, "evidence", handleFile)} />
        </label>
        <br />
        <label>
          artifact.json (combined)
          <input type="file" accept="application/json" onChange={(event) => onPick(event, "artifact", handleFile)} />
        </label>
      </section>

      <section>
        <h2>Verification status</h2>
        <Badge label={localVerification.isVerified ? "Verified" : "Unverified"} />
        <span> </span>
        <span>{renderProvenance("DERIVED")}</span>
        <p>{localVerification.hashReason}</p>
        <p>{localVerification.signatureReason}</p>
        <p>
          <strong>Receipt ID:</strong> {effectiveMaster?.receipt_id ?? "(missing)"}
        </p>
        <p>
          <strong>Content hash:</strong> {contentHash ?? "(missing)"}{" "}
          {contentHash ? (
            <button type="button" onClick={() => navigator.clipboard.writeText(contentHash)}>
              Copy
            </button>
          ) : null}
        </p>
      </section>

      <section>
        <h2>Signed Master Receipt</h2>
        <p>{renderProvenance("SIGNED")}</p>
        <Field label="receipt_version" value={effectiveMaster?.receipt_version} provenance="SIGNED" />
        <Field label="receipt_id" value={effectiveMaster?.receipt_id} provenance="SIGNED" />
        <Field label="content_hash" value={effectiveMaster?.content_hash} provenance="SIGNED" />
        <Field
          label="signature"
          value={truncateValue(effectiveMaster?.signature)}
          provenance="SIGNED"
        />
        <Field
          label="metadata"
          value={safeStringify(effectiveMaster?.metadata)}
          provenance="SIGNED"
        />
      </section>

      <section>
        <h2>Derived Verification</h2>
        <p>{renderProvenance("DERIVED")}</p>
        <Field
          label="local_verification (recomputed now)"
          value={safeStringify({
            canRecomputeHash: localVerification.canRecomputeHash,
            recomputedHash: localVerification.recomputedHash,
            hashMatches: localVerification.hashMatches,
            signatureChecked: localVerification.signatureChecked,
            signatureValid: localVerification.signatureValid,
            verified: localVerification.isVerified,
          })}
          provenance="DERIVED"
        />
        <Field
          label="artifact.verification (from artifact)"
          value={safeStringify(effectiveMaster?.verification)}
          provenance="DERIVED"
        />
      </section>

      <section>
        <h2>Evidence Pack (Sensitive)</h2>
        <Badge label="Sensitive" /> <span>{renderProvenance("UNSIGNED")}</span>
        <details>
          <summary>Transcript (collapsed by default)</summary>
          <pre>{safeStringify(effectiveEvidence?.transcript)}</pre>
        </details>

        <table>
          <thead>
            <tr>
              <th>assertion_type</th>
              <th>text</th>
              <th>confidence</th>
              <th>sources</th>
            </tr>
          </thead>
          <tbody>
            {(effectiveEvidence?.eli_assertions ?? []).map((assertion, index) => (
              <tr key={`${assertion.assertion_type}-${index}`}>
                <td>{assertion.assertion_type}</td>
                <td>{assertion.text}</td>
                <td>{assertion.confidence ?? ""}</td>
                <td>{assertion.sources.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Unsigned Commentary</h2>
        <p>{renderProvenance("UNSIGNED")}</p>
        <pre>{effectiveEvidence?.commentary ?? "(none)"}</pre>
      </section>

      <section>
        <h2>Safety / leak scan</h2>
        <p>{leakResult.ok ? "No credential leaks detected." : "Credential leak patterns detected."}</p>
        {leakResult.findings.map((finding, index) => (
          <p key={`${finding.location}-${finding.pattern}-${index}`}>
            {finding.location}: {finding.pattern}
          </p>
        ))}
        <button type="button" disabled={!leakResult.ok}>
          Share / Export
        </button>
      </section>

      {warnings.length > 0 ? (
        <section>
          <h2>Warnings</h2>
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </section>
      ) : null}
    </main>
  );
}

function envString(name: "VITE_OPENAI_API_KEY" | "VITE_RECEIPT_SIGNING_KEY" | "VITE_RECEIPT_VERIFY_KEY"): string | undefined {
  const value = import.meta.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function onPick(
  event: ChangeEvent<HTMLInputElement>,
  kind: UploadedKind,
  handler: (kind: UploadedKind, file: File) => Promise<void>
): Promise<void> {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    await handler(kind, file);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

function Badge({ label }: { label: string }): JSX.Element {
  return <strong>[{label}]</strong>;
}

function Field({
  label,
  value,
  provenance,
}: {
  label: string;
  value: string | undefined;
  provenance: ProvenanceLabel;
}): JSX.Element {
  return (
    <p>
      <strong>{label}</strong> {renderProvenance(provenance)}: {value ?? "(missing)"}
    </p>
  );
}

function renderProvenance(label: ProvenanceLabel): string {
  return `[${label}]`;
}

function truncateValue(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}…${value.slice(-12)}`;
}

function safeStringify(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "(unable to render value)";
  }
}
