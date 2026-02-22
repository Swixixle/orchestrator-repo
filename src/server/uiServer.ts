#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, resolve, join, normalize } from "node:path";

const host = process.env.UI_HOST ?? "0.0.0.0";
const port = Number(process.env.UI_PORT ?? "8080");
const basePath = normalizeBasePath(process.env.UI_BASE_PATH ?? "/");
const distDir = resolve(process.env.UI_DIST_DIR ?? "ui/dist");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const indexHtmlPath = resolve(distDir, "index.html");
ensureBuildExists(indexHtmlPath);

const server = createServer((req, res) => {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (basePath !== "/" && pathname === "/") {
    res.statusCode = 302;
    res.setHeader("Location", basePath);
    res.end();
    return;
  }

  const strippedPath = stripBasePath(pathname, basePath);
  if (strippedPath === null) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  const candidatePath = resolveSafeAssetPath(distDir, strippedPath);
  if (candidatePath && isFile(candidatePath)) {
    serveFile(candidatePath, strippedPath, method, res);
    return;
  }

  if (hasFileExtension(strippedPath)) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  serveFile(indexHtmlPath, "index.html", method, res);
});

server.listen(port, host, () => {
  const printableHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`Evidence Inspector running at http://${printableHost}:${port}${basePath}`);
});

function serveFile(
  filePath: string,
  requestPath: string,
  method: string,
  res: import("node:http").ServerResponse
): void {
  const extension = extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] ?? "application/octet-stream";

  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (requestPath === "index.html" || requestPath === "/index.html") {
    res.setHeader("Cache-Control", "no-store");
  } else if (requestPath.includes("/assets/") || requestPath.startsWith("assets/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "public, max-age=3600");
  }

  if (method === "HEAD") {
    res.end();
    return;
  }

  const body = readFileSync(filePath);
  res.end(body);
}

function normalizeBasePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "/") return "/";
  const leading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return leading.endsWith("/") ? leading : `${leading}/`;
}

function stripBasePath(pathname: string, base: string): string | null {
  if (base === "/") {
    return pathname;
  }

  const baseNoTrailing = base.slice(0, -1);
  if (pathname === baseNoTrailing || pathname === base) {
    return "/";
  }

  if (!pathname.startsWith(base)) {
    return null;
  }

  const stripped = pathname.slice(base.length - 1);
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

function resolveSafeAssetPath(rootDir: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath);
  const normalizedPath = normalize(decoded).replace(/^\.\.(\/|\\|$)/, "");
  const filePath = resolve(join(rootDir, normalizedPath.slice(1)));

  const rootWithSep = rootDir.endsWith("/") ? rootDir : `${rootDir}/`;
  if (!filePath.startsWith(rootWithSep) && filePath !== rootDir) {
    return null;
  }

  return filePath;
}

function ensureBuildExists(indexPath: string): void {
  if (!isFile(indexPath)) {
    throw new Error(
      `UI build not found at ${indexPath}. Run: npm run ui:build`
    );
  }
}

function hasFileExtension(pathname: string): boolean {
  return /\.[A-Za-z0-9]+$/.test(pathname);
}

function isFile(filePath: string): boolean {
  const st = statSync(filePath, { throwIfNoEntry: false });
  return Boolean(st?.isFile());
}
