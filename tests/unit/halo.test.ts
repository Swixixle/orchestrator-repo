import { describe, it, expect } from "vitest";
import { signResponse } from "../../src/mocks/haloMock.js";
import { verifyReceipt } from "../../src/mocks/haloMock.js";

const TEST_KEY = "test-signing-key-32-bytes-padded!";

describe("HALO signer", () => {
  it("produces a receipt with required fields", () => {
    const receipt = signResponse("Hello, world!", TEST_KEY);

    expect(receipt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(receipt.timestamp).toBeTruthy();
    expect(receipt.responseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.response).toBe("Hello, world!");
  });

  it("produces a deterministic hash for the same response", () => {
    const r1 = signResponse("deterministic", TEST_KEY);
    const r2 = signResponse("deterministic", TEST_KEY);

    expect(r1.responseHash).toBe(r2.responseHash);
  });

  it("produces a different hash for different responses", () => {
    const r1 = signResponse("response A", TEST_KEY);
    const r2 = signResponse("response B", TEST_KEY);

    expect(r1.responseHash).not.toBe(r2.responseHash);
  });
});

describe("HALO verifier", () => {
  it("verifies an unmodified receipt", () => {
    const receipt = signResponse("The sky is blue.", TEST_KEY);
    const result = verifyReceipt(receipt, TEST_KEY);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("fails verification when the response is tampered", () => {
    const receipt = signResponse("Original content.", TEST_KEY);
    const tampered = { ...receipt, response: "Tampered content." };
    const result = verifyReceipt(tampered, TEST_KEY);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("hash mismatch");
  });

  it("fails verification when the signature is tampered", () => {
    const receipt = signResponse("Original content.", TEST_KEY);
    const tampered = { ...receipt, signature: "a".repeat(64) };
    const result = verifyReceipt(tampered, TEST_KEY);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("signature");
  });

  it("fails verification when the wrong key is used", () => {
    const receipt = signResponse("Some text.", TEST_KEY);
    const result = verifyReceipt(receipt, "wrong-key-32-bytes-xxxxxxxxxxxx!!!");

    expect(result.valid).toBe(false);
  });
});
