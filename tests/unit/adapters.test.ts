/**
 * Adapter isolation test.
 *
 * Ensures that no unit test file in this suite imports from src/adapters/.
 * The adapter layer is reserved for the E2E test path (RUN_E2E=1) and must
 * not leak into the deterministic unit suite.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("adapter isolation – unit suite must not import adapters", () => {
  // Collect all unit test files except this one
  const unitDir = __dirname;
  // Excluded from the isolation check:
  //   adapters.test.ts             – this file itself
  //   haloReceipts.contract.test.ts – integration smoke test; imports from
  //                                   src/adapters intentionally to validate
  //                                   the contract loader (no live LLM calls).
  //   anthropicAdapter.test.ts      – adapter-local pure mapping/parsing tests.
  const ISOLATION_EXCLUDED = new Set([
    "adapters.test.ts",
    "haloReceipts.contract.test.ts",
    "anthropicAdapter.test.ts",
  ]);

  const unitFiles = readdirSync(unitDir)
    .filter((f) => f.endsWith(".test.ts") && !ISOLATION_EXCLUDED.has(f))
    .map((f) => join(unitDir, f));

  for (const filePath of unitFiles) {
    it(`${filePath.split("/").pop()} does not import from src/adapters`, () => {
      const content = readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/src\/adapters/);
    });
  }
});
