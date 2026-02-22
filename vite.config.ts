import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function resolveBasePath(): string {
  const raw = process.env.UI_BASE_PATH?.trim() || "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig({
  base: resolveBasePath(),
  plugins: [react()],
  build: {
    outDir: "ui/dist",
  },
});
