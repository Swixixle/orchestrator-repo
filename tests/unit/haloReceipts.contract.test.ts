/**
 * HALO-RECEIPTS integration smoke test.
 *
 * This is NOT an E2E model call.  It validates the integration contract
 * without requiring OPENAI_API_KEY or any network access.
 *
 * What it checks:
 *   - loadHaloReceiptsContract() resolves without throwing
 *   - HALO_RECEIPTS_CONTRACT is exported from the package root (no deep-path imports)
 *   - The returned contract has all required callable exports
 *   - contractVersion is a parseable semver string
 *
 * If halo-receipts is not installed, the test skips gracefully.
 * This catches export-surface drift early, before E2E is needed.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  loadHaloReceiptsContract,
  _resetContractCacheForTest,
} from "../../src/adapters/haloReceiptsContract.js";

describe("HALO-RECEIPTS integration contract smoke test", () => {
  afterEach(() => {
    _resetContractCacheForTest();
  });

  it("loads the contract and exposes required exports when halo-receipts is installed", async () => {
    let contract;
    try {
      contract = await loadHaloReceiptsContract();
    } catch (err) {
      // If halo-receipts is not installed, skip gracefully.
      if (
        err instanceof Error &&
        err.message.includes("[halo-receipts contract] Package not installed")
      ) {
        console.log("  ↩  halo-receipts not installed – smoke test skipped.");
        return;
      }
      throw err;
    }

    // Required callable exports
    expect(typeof contract.invokeLLMWithHalo).toBe("function");
    expect(typeof contract.verifyTranscriptReceipt).toBe("function");

    // Contract version must be a non-empty semver-like string
    expect(typeof contract.contractVersion).toBe("string");
    expect(contract.contractVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("returns a cached contract on second call (no duplicate imports)", async () => {
    let first;
    try {
      first = await loadHaloReceiptsContract();
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("[halo-receipts contract] Package not installed")
      ) {
        return; // skip
      }
      throw err;
    }

    const second = await loadHaloReceiptsContract();
    expect(second).toBe(first); // strict reference equality – same cached object
  });

  it("verifyTranscriptReceipt returns { ok: false } for a mismatched transcript hash", async () => {
    let contract;
    try {
      contract = await loadHaloReceiptsContract();
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("[halo-receipts contract] Package not installed")
      ) {
        return; // skip
      }
      throw err;
    }

    // Craft a receipt with a deliberately wrong transcript_hash.
    // signed_payload is intentionally minimal/malformed — this test only
    // exercises the hash-mismatch path, not signature verification.
    const fakeReceipt = {
      id: "test-id",
      ts: new Date().toISOString(),
      transcript_hash: "0000000000000000000000000000000000000000000000000000000000000000",
      signature: "AAAA",
      signature_alg: "Ed25519" as const,
      public_key_id: "test-key",
      signed_payload: JSON.stringify({ kid: "test-key", transcript_hash: "0000", ts: "now" }),
    };

    const result = await contract.verifyTranscriptReceipt({ some: "data" }, fakeReceipt);

    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("transcript_hash mismatch");
  });
});
