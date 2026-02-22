import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

describe("sample fixture generation", () => {
  it("generates expected evidence inspector fixture files", () => {
    execFileSync("node", ["scripts/generate-evidence-inspector-samples.mjs"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    const sampleDir = path.join(process.cwd(), "samples", "evidence-inspector");
    const expectedFiles = [
      "README.md",
      "artifact.valid.json",
      "artifact.with_leak.json",
      "evidence_pack.tampered_transcript.json",
      "evidence_pack.valid.json",
      "master_receipt.tampered_content_hash.json",
      "master_receipt.valid.json",
    ];

    for (const fileName of expectedFiles) {
      const fullPath = path.join(sampleDir, fileName);
      expect(fs.existsSync(fullPath)).toBe(true);
    }

    const leakFixturePath = path.join(sampleDir, "artifact.with_leak.json");
    const leakFixtureText = fs.readFileSync(leakFixturePath, "utf8");
    expect(leakFixtureText).toContain("Bearer ");

    const masterValidPath = path.join(sampleDir, "master_receipt.valid.json");
    const evidenceValidPath = path.join(sampleDir, "evidence_pack.valid.json");
    const evidenceTamperedPath = path.join(sampleDir, "evidence_pack.tampered_transcript.json");

    const masterValid = JSON.parse(fs.readFileSync(masterValidPath, "utf8")) as {
      content_hash: string;
    };
    const evidenceValid = JSON.parse(fs.readFileSync(evidenceValidPath, "utf8")) as {
      transcript: unknown;
    };
    const evidenceTampered = JSON.parse(fs.readFileSync(evidenceTamperedPath, "utf8")) as {
      transcript: unknown;
    };

    const validHash = sha256Hex(canonicalize(evidenceValid.transcript));
    const tamperedHash = sha256Hex(canonicalize(evidenceTampered.transcript));

    expect(validHash).toBe(masterValid.content_hash);
    expect(tamperedHash).not.toBe(masterValid.content_hash);
  });
});

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map((key) => {
      const record = value as Record<string, unknown>;
      return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
    });
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
