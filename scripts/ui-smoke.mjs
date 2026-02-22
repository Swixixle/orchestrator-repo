import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const port = 18080 + Math.floor(Math.random() * 1000);
const host = "127.0.0.1";
const basePath = "/";

const server = spawn("node", ["dist/server/uiServer.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    UI_HOST: host,
    UI_PORT: String(port),
    UI_BASE_PATH: basePath,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let startupOutput = "";
server.stdout.on("data", (chunk) => {
  startupOutput += String(chunk);
});
server.stderr.on("data", (chunk) => {
  startupOutput += String(chunk);
});

try {
  await waitForServer(`http://${host}:${port}/`);

  const rootResponse = await fetch(`http://${host}:${port}/`);
  const rootHtml = await rootResponse.text();
  if (!rootResponse.ok || !rootHtml.includes("Evidence Inspector")) {
    throw new Error("Root HTML check failed.");
  }

  const assetPath = parseFirstAssetPath(rootHtml);
  if (!assetPath) {
    throw new Error("Could not locate built asset path from index.html.");
  }

  const assetResponse = await fetch(`http://${host}:${port}${assetPath}`);
  if (!assetResponse.ok) {
    throw new Error(`Asset request failed: ${assetPath}`);
  }

  const deepLinkResponse = await fetch(`http://${host}:${port}/some/deep/link`);
  const deepLinkHtml = await deepLinkResponse.text();
  if (!deepLinkResponse.ok || !deepLinkHtml.includes("Evidence Inspector")) {
    throw new Error("SPA deep-link fallback check failed.");
  }

  const builtIndexPath = resolve("ui/dist/index.html");
  const builtIndex = readFileSync(builtIndexPath, "utf8");
  if (!builtIndex.includes("Evidence Inspector")) {
    throw new Error("Built index marker check failed.");
  }

  console.log("[ui:smoke] PASS");
} catch (error) {
  console.error("[ui:smoke] FAIL:", error instanceof Error ? error.message : String(error));
  console.error(startupOutput);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}

async function waitForServer(url) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error("Timed out waiting for ui server startup.");
}

function parseFirstAssetPath(html) {
  const scriptMatch = html.match(/<script[^>]+src=["']([^"']+)["']/i);
  const styleMatch = html.match(/<link[^>]+href=["']([^"']+)["']/i);
  const candidate = scriptMatch?.[1] || styleMatch?.[1];
  if (!candidate) return null;

  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return new URL(candidate).pathname;
  }

  return candidate.startsWith("/") ? candidate : `/${candidate}`;
}
