import { describe, expect, it } from "vitest";
import { createHmac, generateKeyPairSync } from "node:crypto";
import {
  canonicalJson,
  createMasterReceipt,
  normalizeValetToTranscript,
  sha256Hex,
  verifyCheckpointOffline,
  verifyValetHmac,
} from "../../src/cli/ingestValet.js";

describe("ingestValet bridge helpers", () => {
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
    const hmacKey = "valet-test-key";
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
    const hmacKey = "valet-test-key";
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
    const hmacKey = "valet-test-key";
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
});
