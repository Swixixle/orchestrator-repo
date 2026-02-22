import { describe, expect, it } from "vitest";
import { normalizeArtifact } from "../../src/ui/normalizeArtifact.js";

describe("normalizeArtifact", () => {
  it("normalizes nested master_receipt + evidence_pack", () => {
    const normalized = normalizeArtifact({
      master_receipt: {
        receipt_version: "1.0",
        receipt_id: "r-1",
        content_hash: "abc",
        signature: "sig",
      },
      evidence_pack: {
        receipt_id: "r-1",
        content_hash: "abc",
        transcript: { text: "hello" },
        eli_assertions: [
          { assertion_type: "FACT", text: "hello", confidence: 0.99, sources: ["line:1"] },
        ],
      },
    });

    expect(normalized.master_receipt?.receipt_id).toBe("r-1");
    expect(normalized.evidence_pack?.eli_assertions[0]?.assertion_type).toBe("FACT");
    expect(normalized.warnings).toEqual([]);
  });

  it("normalizes combined orchestrator artifact shape", () => {
    const normalized = normalizeArtifact({
      haloReceipt: {
        id: "receipt-42",
        transcript_hash: "hash-42",
        signature: "signature",
      },
      transcript: { role: "assistant", content: "text" },
      eliLedger: {
        claims: [{ type: "INFERENCE", text: "derived", span_refs: [{ start: 0, end: 6 }] }],
      },
      commentary: "analyst note",
    });

    expect(normalized.master_receipt?.receipt_id).toBe("receipt-42");
    expect(normalized.master_receipt?.content_hash).toBe("hash-42");
    expect(normalized.evidence_pack?.eli_assertions[0]?.assertion_type).toBe("INFERENCE");
    expect(normalized.evidence_pack?.commentary).toBe("analyst note");
  });

  it("returns warning when nothing can be inferred", () => {
    const normalized = normalizeArtifact({ hello: "world" });
    expect(normalized.master_receipt).toBeUndefined();
    expect(normalized.evidence_pack).toBeUndefined();
    expect(normalized.warnings.length).toBeGreaterThan(0);
  });
});
