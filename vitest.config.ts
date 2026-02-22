import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // Alias halo-receipts to its TypeScript source entry so tests work
    // without a pre-built dist/ (the package exports point to dist/index.js
    // which only exists after running `npm run build` in that package).
    alias: {
      "halo-receipts": resolve(
        __dirname,
        "node_modules/halo-receipts/server/integration-contract.ts"
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
