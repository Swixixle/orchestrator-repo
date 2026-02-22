import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { generateReceipt } from '../../src/orchestrator'; // Adjust if needed

const GOLDEN_DIR = path.join(__dirname, '../golden-receipts');
const PROVIDERS = ['openai', 'anthropic', 'gemini'];
const PROMPT = 'Return the word HALO exactly.';

function loadGolden(provider: string) {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, `${provider}.receipt.json`), 'utf8'));
}

describe('Golden Receipt Contract Integrity', () => {
  for (const provider of PROVIDERS) {
    it(`matches golden receipt for ${provider}`, async () => {
      const golden = loadGolden(provider);
      // Deterministically generate a new receipt
      const receipt = await generateReceipt({
        provider,
        prompt: PROMPT,
        // Add any required deterministic options here
      });
      expect(receipt).toStrictEqual(golden);
    });
  }
});
