import { describe, expect, it } from "vitest";
import { canonicalize, recomputeVerification } from "../../src/ui/localVerification.js";

describe("local verification", () => {
  it("produces stable canonical JSON ordering", () => {
    const value = { z: 1, a: { c: 2, b: 1 } };
    expect(canonicalize(value)).toBe('{"a":{"b":1,"c":2},"z":1}');
  });

  it("marks unverified when evidence pack is missing", async () => {
    const result = await recomputeVerification(
      {
        raw: {},
        receipt_id: "r-1",
        content_hash: "abc",
      },
      undefined
    );

    expect(result.isVerified).toBe(false);
    expect(result.canRecomputeHash).toBe(false);
    expect(result.hashReason).toContain("no evidence pack");
  });

  it("computes hash and compares against content_hash", async () => {
    const transcript = { text: "hello" };
    const expectedHash = "cbbbdcd27692344de5dbab3abcaba413fb0f45307267de7081401576df1cb176";

    const result = await recomputeVerification(
      {
        raw: {},
        receipt_id: "r-2",
        content_hash: expectedHash,
        signature: "deadbeef",
      },
      {
        raw: {},
        eli_assertions: [],
        transcript,
      }
    );

    expect(result.canRecomputeHash).toBe(true);
    expect(result.recomputedHash).toBe(expectedHash);
    expect(result.hashMatches).toBe(true);
    expect(result.isVerified).toBe(false);
    expect(result.signatureReason).toContain("missing public key");
  });
});
