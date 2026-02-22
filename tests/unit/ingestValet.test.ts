import { describe, expect, it } from "vitest";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  canonicalizeValetTranscript,
  createMasterReceipt,
  parseIngestArgs,
  runIngestValet,
  sha256Hex,
  verifyCheckpointOffline,
  verifyValetHmac,
} from "../../src/cli/ingestValet.js";

const TEST_HMAC_KEY = "integration-test-hmac-key";
const TEST_SIGNING_KEY = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEICv6QK6QK6QK6QK6QK6QK6QK6QK6QK6QK6QK6QK6QK6QK6Q\n-----END PRIVATE KEY-----";

describe("ingestValet bridge helpers", () => {
        // IMPORTANT:
        // This test dynamically computes HMAC using the exact CLI canonicalization function.
        // Do NOT hardcode signature values in fixtures.
        // If canonicalization logic changes, this test will remain valid.
      // IMPORTANT:
      // This test dynamically computes HMAC using the exact CLI canonicalization function.
      // Do NOT hardcode signature values in fixtures.
      // This prevents cryptographic drift if canonicalization logic changes.
    it("runs ingest-valet CLI end-to-end with fixture directory", () => {
      // Build first to ensure dist/cli/ingestValet.js is up to date
      const build = spawnSync("npm", ["run", "console:build"], { cwd: process.cwd(), shell: true });
      expect(build.status).toBe(0);

      // Load fixture receipt
      const fixturePath = join(process.cwd(), "tests/fixtures/valet-integration", "receipt.json");
      const receipt = JSON.parse(readFileSync(fixturePath, "utf8"));

      // Compute canonical transcript and HMAC
      const canonical = canonicalizeValetTranscript(receipt);
      const hmac = createHmac("sha256", TEST_HMAC_KEY).update(canonical).digest("hex");
      receipt.signature = hmac;
      receipt.signature_type = "hmac-sha256";

      // Write temp receipt to temp directory
      const tempDir = mkdtempSync(join(tmpdir(), "ingest-valet-integration-"));
      writeFileSync(join(tempDir, "receipt.json"), JSON.stringify(receipt, null, 2));

      // Generate Ed25519 keypair for signing and verification
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

      // Run ingest-valet CLI with temp directory
      const result = spawnSync(
        "node",
        ["dist/cli/ingestValet.js", tempDir, "--quiet"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            VALET_RECEIPT_HMAC_KEY: TEST_HMAC_KEY,
            RECEIPT_SIGNING_KEY: privatePem,
            RECEIPT_VERIFY_KEY: publicPem,
          }
        }
      );
      console.log("STDOUT:", result.stdout.toString());
      console.log("STDERR:", result.stderr.toString());
      console.log("EXIT:", result.status);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("matched_hmac_strategy");
      expect(result.stdout).toContain("protocol_report");

      // Check protocol_report.json exists and is valid
      const reportPath = join(tempDir, "halo_checkpoint", "protocol_report.json");
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      expect(report.status).toBe("PASS");
      expect(Array.isArray(report.checks)).toBe(true);

      rmSync(tempDir, { recursive: true, force: true });
    });
  it("prints error and usage when CLI is run with no arguments", () => {
    // Build first to ensure dist/cli/ingestValet.js is up to date
    const build = spawnSync("npm", ["run", "console:build"], { cwd: process.cwd(), shell: true });
    expect(build.status).toBe(0);

    const result = spawnSync("node", ["dist/cli/ingestValet.js"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).toBe(0); // usage exits with 0
    expect(result.stderr).toContain("Missing required <valet-dist-dir> argument");
    expect(result.stdout).toContain("Usage: ingestValet");
    expect(result.stdout).toContain("--quiet");
  });

  it("prints usage and exits with 0 when CLI is run with --help", () => {
    // Build first to ensure dist/cli/ingestValet.js is up to date
    const build = spawnSync("npm", ["run", "console:build"], { cwd: process.cwd(), shell: true });
    expect(build.status).toBe(0);

    const result = spawnSync("node", ["dist/cli/ingestValet.js", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).toBe(0); // usage exits with 0
    expect(result.stdout).toContain("Usage: ingestValet");
    expect(result.stdout).toContain("--quiet");
    expect(result.stdout).toContain("<valet-dist-dir>");
    expect(result.stderr).toBe("");
  });
  it("parses ingest args with --quiet flag", () => {
    const parsed = parseIngestArgs(["node", "ingestValet.ts", "--quiet", "dist/sample"]);
    expect(parsed.quiet).toBe(true);
    expect(parsed.inputDir.endsWith("dist/sample")).toBe(true);
  });

  it("parses ingest args with -q flag", () => {
    const parsed = parseIngestArgs(["node", "ingestValet.ts", "-q", "dist/sample"]);
    expect(parsed.quiet).toBe(true);
    expect(parsed.inputDir.endsWith("dist/sample")).toBe(true);
  });

  it("normalizes prompt/completion valet receipt to canonical transcript", () => {
    const transcript = normalizeValetToTranscript({
      prompt: "What causes tides?",
      completion: "The Moon and Sun gravity drive tides.",
      model: "gpt-x",
      created_at: "2026-02-22T00:00:00.000Z",
    });

    const messages = transcript.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(transcript.model).toBe("gpt-x");
  });

  it("verifies valet HMAC using canonical transcript strategy", () => {
    const hmacKey = TEST_HMAC_KEY;
    const receipt = {
      prompt: "A",
      completion: "B",
    } as Record<string, unknown>;

    const transcript = normalizeValetToTranscript(receipt);
    const payload = canonicalJson(transcript);
    const signature = createHmac("sha256", hmacKey).update(payload, "utf8").digest("hex");

    const result = verifyValetHmac(
      {
        ...receipt,
        signature,
        signature_type: "hmac-sha256",
      },
      hmacKey
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe("canonical_transcript");
  });

  it("verifies valet HMAC using transcript_hash_field strategy", () => {
    const hmacKey = TEST_HMAC_KEY;
    const transcriptHash = "abc123-transcript-hash";

    const signature = createHmac("sha256", hmacKey).update(transcriptHash, "utf8").digest("hex");

    const result = verifyValetHmac(
      {
        prompt: "A",
        completion: "B",
        transcript_hash: transcriptHash,
        signature,
        signature_type: "hmac-sha256",
      },
      hmacKey
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe("transcript_hash_field");
  });

  it("verifies valet HMAC using canonical receipt without signatures strategy", () => {
    const hmacKey = TEST_HMAC_KEY;
    const receipt = {
      request: { model: "gpt-x", prompt: "What causes tides?" },
      response: { text: "Mostly gravity from the Moon and Sun." },
      created_at: "2026-02-22T00:00:00.000Z",
      metadata: { run_id: "r-123" },
    } as Record<string, unknown>;

    const signature = createHmac("sha256", hmacKey)
      .update(canonicalJson(receipt), "utf8")
      .digest("hex");

    const result = verifyValetHmac(
      {
        ...receipt,
        signature,
        signature_type: "hmac-sha256",
      },
      hmacKey
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe("canonical_receipt_without_signatures");
  });

  it("creates and verifies Ed25519 checkpoint receipts", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const transcript = normalizeValetToTranscript({
      messages: [
        { role: "user", content: "Explain tides" },
        { role: "assistant", content: "Mostly Moon and Sun gravity." },
      ],
      model: "gpt-test",
      created_at: "2026-02-22T00:00:00.000Z",
    });

    const { master_receipt, evidence_pack } = createMasterReceipt({
      transcript,
      sourceDir: "/tmp/valet/dist-slug",
      sourceReceiptFile: "receipt.json",
      sourceFiles: [{ file: "receipt.json", sha256: sha256Hex("receipt") }],
      matchedHmacStrategy: "canonical_transcript",
      signingKeyPem: privatePem,
    });

    expect(master_receipt.content_hash).toBe(evidence_pack.content_hash);
    expect(master_receipt.signature_scheme).toBe("ed25519");

    const serialisedMaster = JSON.stringify(master_receipt);
    expect(serialisedMaster.includes("\"transcript\"")).toBe(false);

    const verified = verifyCheckpointOffline({
      masterReceipt: master_receipt,
      evidencePack: evidence_pack,
      verifyKeyPem: publicPem,
    });
    expect(verified.ok).toBe(true);

    const tamperedEvidence = {
      ...evidence_pack,
      transcript: {
        ...(evidence_pack.transcript as Record<string, unknown>),
        tampered: true,
      },
    };

    const tamperedVerify = verifyCheckpointOffline({
      masterReceipt: master_receipt,
      evidencePack: tamperedEvidence,
      verifyKeyPem: publicPem,
    });
    expect(tamperedVerify.ok).toBe(false);
  });

  it("fails offline verification when no verify key is available", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const transcript = normalizeValetToTranscript({
      prompt: "Explain tides",
      completion: "Mainly Moon and Sun gravity.",
      model: "gpt-test",
      created_at: "2026-02-22T00:00:00.000Z",
    });

    const { master_receipt, evidence_pack } = createMasterReceipt({
      transcript,
      sourceDir: "/tmp/valet/dist-slug",
      sourceReceiptFile: "receipt.json",
      sourceFiles: [{ file: "receipt.json", sha256: sha256Hex("receipt") }],
      matchedHmacStrategy: "canonical_transcript",
      signingKeyPem: privatePem,
    });

    const verified = verifyCheckpointOffline({
      masterReceipt: {
        ...master_receipt,
        metadata: { ...master_receipt.metadata, public_key: undefined },
      },
      evidencePack: evidence_pack,
    });

    expect(verified.ok).toBe(false);
    expect(verified.reason).toContain("missing verify key");
  });

  it("exits with code 1 when VALET_RECEIPT_HMAC_KEY is missing", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "ingest-valet-"));
    writeFileSync(
      join(fixtureDir, "receipt.json"),
      JSON.stringify(
        {
          prompt: "What causes tides?",
          completion: "Mainly Moon and Sun gravity.",
          model: "gpt-test",
          created_at: "2026-02-22T00:00:00.000Z",
          signature_type: "hmac-sha256"
        },
        null,
        2
      )
    );
    const result = spawnSync(
      "node",
      ["dist/cli/ingestValet.js", fixtureDir, "--quiet"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, VALET_RECEIPT_HMAC_KEY: undefined },
      }
    );
    expect(result.status).toBe(1);
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("exits with code 1 when RECEIPT_SIGNING_KEY is missing after HMAC verification passes", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "ingest-valet-"));
    const hmacKey = TEST_HMAC_KEY;
    const receipt = {
      prompt: "What causes tides?",
      completion: "Mainly Moon and Sun gravity.",
      model: "gpt-test",
      created_at: "2026-02-22T00:00:00.000Z",
      signature_type: "hmac-sha256"
    } as Record<string, unknown>;
    const canonical = canonicalizeValetTranscript(receipt);
    const hmac = createHmac("sha256", hmacKey).update(canonical).digest("hex");
    receipt.signature = hmac;
    receipt.signature_type = "hmac-sha256";
    writeFileSync(
      join(fixtureDir, "receipt.json"),
      JSON.stringify(receipt, null, 2)
    );
    const result = spawnSync(
      "node",
      ["dist/cli/ingestValet.js", fixtureDir, "--quiet"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, VALET_RECEIPT_HMAC_KEY: hmacKey, RECEIPT_SIGNING_KEY: undefined },
      }
    );
    expect(result.status).toBe(1);
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("exits with code 1 when valet HMAC is invalid", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "ingest-valet-"));
    const hmacKey = TEST_HMAC_KEY;
    const receipt = {
      prompt: "What causes tides?",
      completion: "Mainly Moon and Sun gravity.",
      model: "gpt-test",
      created_at: "2026-02-22T00:00:00.000Z",
      signature: "definitely-invalid-signature",
      signature_type: "hmac-sha256"
    } as Record<string, unknown>;
    writeFileSync(
      join(fixtureDir, "receipt.json"),
      JSON.stringify(receipt, null, 2)
    );
    const result = spawnSync(
      "node",
      ["dist/cli/ingestValet.js", fixtureDir, "--quiet"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, VALET_RECEIPT_HMAC_KEY: hmacKey },
      }
    );
    expect(result.status).toBe(1);
    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
