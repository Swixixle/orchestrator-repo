import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    server: {
      deps: {
        // halo-receipts ships TypeScript source with no compiled output.
        // Vitest must transform it (instead of treating it as an opaque
        // node_module) so that sub-path .ts imports resolve correctly.
        inline: ["halo-receipts"],
      },
    },
  },
});
