#!/usr/bin/env node
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { runPipeline } from "../orchestrator.js";
import { runVerify } from "../cli/verify.js";
import { scanForLeaks } from "../utils/leakScan.js";
import { invokeLLMWithHaloAdapter } from "../adapters/haloReceiptsAdapter.js";
import { invokeAnthropicLLM } from "../adapters/anthropicAdapter.js";
import { renderMasterConsoleHtml } from "./masterConsoleHtml.js";

const require = createRequire(import.meta.url);
const express = require("express") as typeof import("express");
const { Client } = require("pg") as typeof import("pg");
const packageJson = require("../../package.json") as { version?: string };

const app = express();
const host = process.env.CONSOLE_HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? process.env.CONSOLE_PORT ?? "8080");
const uiDist = resolve(process.env.CONSOLE_UI_DIST_DIR ?? "ui/dist");
const runIndexPath = resolve(
  process.env.CONSOLE_RUN_INDEX_FILE ?? "out/console/run_index.json"
);

const rateWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? "60000");
const rateMax = Number(process.env.RATE_LIMIT_MAX ?? "120");
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(apiHardeningMiddleware);

app.get("/api/health", async (_req: Request, res: Response) => {
  const db = await checkDatabase();
  const inspectorReady = existsSync(join(uiDist, "index.html"));
  const keys = {
    receipt_signing_key: hasSecret("RECEIPT_SIGNING_KEY"),
    receipt_verify_key: hasSecret("RECEIPT_VERIFY_KEY"),
    anthropic_api_key: hasSecret("ANTHROPIC_API_KEY"),
  };

  res.json({
    ok: true,
    db: db.status,
    keys,
    version: packageJson.version ?? "unknown",
    inspector: inspectorReady,
    ready:
      db.status !== "fail" &&
      keys.receipt_signing_key &&
      keys.receipt_verify_key &&
      keys.anthropic_api_key,
  });
});

app.post("/api/run", async (req: Request, res: Response) => {
  try {
    const provider = normalizeProvider(req.body?.provider);
    const model = stringOrDefault(req.body?.model, defaultModel(provider));
    const prompt = String(req.body?.prompt ?? "").trim();
    const outDir = resolve(stringOrDefault(req.body?.outDir, "out/console"));

    if (!prompt) {
      res.status(400).json({ ok: false, error: "prompt is required" });
      return;
    }

    ensureProviderSecrets(provider);

    const llmInvoker = async (promptText: string): Promise<string> => {
      if (provider === "openai") {
        const adapterResult = await invokeLLMWithHaloAdapter({
          endpoint: "/chat/completions",
          model,
          promptOrMessages: promptText,
        });
        return adapterResult.outputText;
      }

      const anthropicResult = await invokeAnthropicLLM({
        model,
        messages: [{ role: "user", content: promptText }],
      });
      return anthropicResult.outputText;
    };

    const pipelineResult = await runPipeline(prompt, llmInvoker);
    const runId = createRunId();

    const leakScan = scanForLeaks(
      [
        { field: "prompt", value: prompt },
        { field: "response", value: pipelineResult.llmResponse },
        { field: "receipt", value: pipelineResult.receipt },
      ],
      [process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    );

    mkdirSync(outDir, { recursive: true });

    const artifactPath = join(outDir, `${runId}.console_artifact.json`);
    const artifactPayload = {
      runId,
      provider,
      model,
      prompt,
      outputText: pipelineResult.llmResponse,
      receipt: pipelineResult.receipt,
      verification: pipelineResult.verification,
      ledger: pipelineResult.ledger,
      semanticValidation: pipelineResult.validation,
      leakScan,
      createdAt: new Date().toISOString(),
    };

    const artifactContent = `${JSON.stringify(artifactPayload, null, 2)}\n`;
    const contentHash = sha256Hex(artifactContent);

    writeFileSync(artifactPath, artifactContent, "utf8");

    await upsertRunIndex({
      runId,
      provider,
      model,
      status: "created",
      contentHash,
      artifactDir: outDir,
      artifactPath,
      promptHash: sha256Hex(prompt),
      createdAt: artifactPayload.createdAt,
    });

    res.json({
      ok: true,
      run_id: runId,
      provider,
      model,
      artifactPath,
      inspectorUrl: "/inspector",
      verification: pipelineResult.verification,
      leakScan,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

app.post("/api/verify", async (req: Request, res: Response) => {
  try {
    const artifactPath = resolve(stringOrDefault(req.body?.artifactPath, ""));
    if (!artifactPath || !existsSync(artifactPath)) {
      res.status(400).json({ ok: false, error: "valid artifactPath is required" });
      return;
    }

    const ok = await runVerify([
      "node",
      "verify.ts",
      "--artifact",
      artifactPath,
      "--out-dir",
      resolve("out/console"),
    ]);

    res.json({ ok, artifactPath });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

app.post("/api/leak-scan", (req: Request, res: Response) => {
  try {
    const payload = req.body ?? {};
    const result = scanForLeaks([{ field: "payload", value: payload }]);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

app.get("/api/runs", async (_req: Request, res: Response) => {
  try {
    const runs = await listRunIndex();
    res.json({ ok: true, runs });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

app.get("/api/runs/:id", async (req: Request, res: Response) => {
  try {
    const runId = stringOrDefault(req.params.id, "");
    if (!runId) {
      res.status(400).json({ ok: false, error: "run id is required" });
      return;
    }
    const run = await getRunIndex(runId);
    if (!run) {
      res.status(404).json({ ok: false, error: "run not found" });
      return;
    }

    const artifact = readJsonIfExists(run.artifactPath);
    res.json({ ok: true, run, artifact });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

app.get("/api/runs/:id/artifact", async (req: Request, res: Response) => {
  try {
    const runId = stringOrDefault(req.params.id, "");
    if (!runId) {
      res.status(400).json({ ok: false, error: "run id is required" });
      return;
    }
    const run = await getRunIndex(runId);
    if (!run || !existsSync(run.artifactPath)) {
      res.status(404).json({ ok: false, error: "artifact not found" });
      return;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${basename(run.artifactPath)}"`
    );
    res.send(readFileSync(run.artifactPath, "utf8"));
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

app.post("/api/tamper", async (req: Request, res: Response) => {
  await handleTamperRequest(req, res);
});

app.post("/api/runs/:id/tamper", async (req: Request, res: Response) => {
  req.body = { ...(req.body ?? {}), run_id: req.params.id };
  await handleTamperRequest(req, res);
});

app.get("/", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderMasterConsoleHtml());
});

if (existsSync(uiDist)) {
  const inspectorAssets = join(uiDist, "assets");
  if (existsSync(inspectorAssets)) {
    app.use("/assets", express.static(inspectorAssets));
  }

  app.use("/inspector", express.static(uiDist));
  app.get("/inspector", (_req: Request, res: Response) => {
    res.sendFile(join(uiDist, "index.html"));
  });
  app.get("/inspector/*", (_req: Request, res: Response) => {
    res.sendFile(join(uiDist, "index.html"));
  });
}

app.listen(port, host, () => {
  console.log(`HALO Console Server listening on http://${host}:${port}`);
  if (existsSync(uiDist)) {
    console.log(`Serving Inspector from ${uiDist} at /inspector`);
  } else {
    console.log(`Inspector build not found at ${uiDist}; Master Console + API mode.`);
  }
});

async function handleTamperRequest(req: Request, res: Response): Promise<void> {
  try {
    const runId = stringOrDefault(req.body?.run_id, "");
    const artifactPathFromBody = stringOrDefault(req.body?.artifactPath, "");

    if (!runId && !artifactPathFromBody) {
      res.status(400).json({ ok: false, error: "run_id or artifactPath is required" });
      return;
    }

    const run = runId ? await getRunIndex(runId) : null;
    const sourceArtifactPath = artifactPathFromBody
      ? resolve(artifactPathFromBody)
      : resolve(run?.artifactPath ?? "");

    if (!sourceArtifactPath || !existsSync(sourceArtifactPath)) {
      res.status(404).json({ ok: false, error: `artifact not found at ${sourceArtifactPath}` });
      return;
    }

    const sourceContent = readFileSync(sourceArtifactPath, "utf8");
    const sourceObject = JSON.parse(sourceContent) as {
      outputText?: unknown;
      prompt?: unknown;
    };

    if (typeof sourceObject.outputText === "string" && sourceObject.outputText.length > 0) {
      const first = sourceObject.outputText[0];
      sourceObject.outputText = `${first === "X" ? "Y" : "X"}${sourceObject.outputText.slice(1)}`;
    } else {
      sourceObject.prompt = `${String(sourceObject.prompt ?? "")} [tampered]`;
    }

    const tamperedPath = sourceArtifactPath.replace(/\.json$/i, ".tampered.json");
    const tamperedContent = `${JSON.stringify(sourceObject, null, 2)}\n`;
    writeFileSync(tamperedPath, tamperedContent, "utf8");

    const expectedHash = run?.contentHash ?? sha256Hex(sourceContent);
    const computedHash = sha256Hex(tamperedContent);

    if (runId) {
      await updateRunStatus(runId, "tampered");
    }

    res.json({
      ok: true,
      run_id: runId || null,
      artifactPath: tamperedPath,
      verification: {
        status: expectedHash === computedHash ? "VALID" : "INVALID",
        expected_hash: expectedHash,
        computed_hash: computedHash,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
}

function apiHardeningMiddleware(req: Request, res: Response, next: () => void): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (req.path.startsWith("/api/")) {
    const origin = process.env.CORS_ORIGIN ?? "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    if (req.path !== "/api/health") {
      const key = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const current = rateBuckets.get(key);

      if (!current || current.resetAt <= now) {
        rateBuckets.set(key, { count: 1, resetAt: now + rateWindowMs });
      } else {
        current.count += 1;
        if (current.count > rateMax) {
          const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
          res.setHeader("Retry-After", String(retryAfterSeconds));
          res.status(429).json({ ok: false, error: "rate limit exceeded" });
          return;
        }
      }
    }
  }

  next();
}

function normalizeProvider(value: unknown): "openai" | "anthropic" {
  const lowered = String(value ?? "openai").toLowerCase();
  return lowered === "anthropic" ? "anthropic" : "openai";
}

function defaultModel(provider: "openai" | "anthropic"): string {
  return provider === "anthropic"
    ? process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022"
    : process.env.E2E_MODEL ?? "gpt-4.1-mini";
}

function ensureProviderSecrets(provider: "openai" | "anthropic"): void {
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when provider=openai");
  }
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when provider=anthropic");
  }
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasSecret(name: string): boolean {
  return typeof process.env[name] === "string" && process.env[name]!.trim().length > 0;
}

function createRunId(): string {
  return randomUUID();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJsonIfExists(filePath: string): unknown | null {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

type RunRecord = {
  runId: string;
  provider: string;
  model: string;
  status: string;
  contentHash: string;
  artifactDir: string;
  artifactPath: string;
  promptHash: string;
  createdAt: string;
};

async function checkDatabase(): Promise<{ status: "ok" | "skipped" | "fail"; detail: string }> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { status: "skipped", detail: "DATABASE_URL not configured" };
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await ensureSchema(client);
    await client.query("select 1");
    return { status: "ok", detail: "connected" };
  } catch (error) {
    return { status: "fail", detail: formatError(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function withDatabase<T>(
  work: (client: import("pg").Client) => Promise<T>
): Promise<T | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await ensureSchema(client);
    return await work(client);
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureSchema(client: import("pg").Client): Promise<void> {
  await client.query(`
    create table if not exists runs (
      run_id text primary key,
      provider text not null,
      model text not null,
      status text not null,
      content_hash text not null,
      artifact_dir text not null,
      artifact_path text not null,
      prompt_hash text not null,
      created_at timestamptz not null default now()
    )
  `);

  await client.query(`alter table runs add column if not exists artifact_path text`);
  await client.query(`alter table runs add column if not exists prompt_hash text`);
  await client.query(`alter table runs add column if not exists created_at timestamptz default now()`);
}

async function upsertRunIndex(entry: RunRecord): Promise<void> {
  const wroteToDb = await withDatabase(async (client) => {
    await client.query(
      `
      insert into runs (
        run_id,
        provider,
        model,
        status,
        content_hash,
        artifact_dir,
        artifact_path,
        prompt_hash,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
      on conflict (run_id)
      do update set
        provider = excluded.provider,
        model = excluded.model,
        status = excluded.status,
        content_hash = excluded.content_hash,
        artifact_dir = excluded.artifact_dir,
        artifact_path = excluded.artifact_path,
        prompt_hash = excluded.prompt_hash,
        created_at = excluded.created_at
    `,
      [
        entry.runId,
        entry.provider,
        entry.model,
        entry.status,
        entry.contentHash,
        entry.artifactDir,
        entry.artifactPath,
        entry.promptHash,
        entry.createdAt,
      ]
    );
    return true;
  });

  if (wroteToDb) {
    return;
  }

  const records = readRunIndexFile();
  const index = records.findIndex((record) => record.runId === entry.runId);
  if (index >= 0) {
    records[index] = entry;
  } else {
    records.push(entry);
  }
  writeRunIndexFile(records);
}

async function listRunIndex(): Promise<RunRecord[]> {
  const dbRows = await withDatabase(async (client) => {
    const result = await client.query<{
      run_id: string;
      provider: string;
      model: string;
      status: string;
      content_hash: string;
      artifact_dir: string;
      artifact_path: string | null;
      prompt_hash: string | null;
      created_at: string;
    }>(
      `
      select
        run_id,
        provider,
        model,
        status,
        content_hash,
        artifact_dir,
        artifact_path,
        prompt_hash,
        created_at::text
      from runs
      order by created_at desc
      limit 200
    `
    );

    return result.rows.map((row) => ({
      runId: row.run_id,
      provider: row.provider,
      model: row.model,
      status: row.status,
      contentHash: row.content_hash,
      artifactDir: row.artifact_dir,
      artifactPath:
        row.artifact_path && row.artifact_path.trim().length > 0
          ? row.artifact_path
          : join(row.artifact_dir, `${row.run_id}.console_artifact.json`),
      promptHash: row.prompt_hash ?? "",
      createdAt: row.created_at,
    }));
  });

  if (dbRows) {
    return dbRows;
  }

  return readRunIndexFile().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getRunIndex(runId: string): Promise<RunRecord | null> {
  const dbRow = await withDatabase(async (client) => {
    const result = await client.query<{
      run_id: string;
      provider: string;
      model: string;
      status: string;
      content_hash: string;
      artifact_dir: string;
      artifact_path: string | null;
      prompt_hash: string | null;
      created_at: string;
    }>(
      `
      select
        run_id,
        provider,
        model,
        status,
        content_hash,
        artifact_dir,
        artifact_path,
        prompt_hash,
        created_at::text
      from runs
      where run_id = $1
      limit 1
    `,
      [runId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      runId: row.run_id,
      provider: row.provider,
      model: row.model,
      status: row.status,
      contentHash: row.content_hash,
      artifactDir: row.artifact_dir,
      artifactPath:
        row.artifact_path && row.artifact_path.trim().length > 0
          ? row.artifact_path
          : join(row.artifact_dir, `${row.run_id}.console_artifact.json`),
      promptHash: row.prompt_hash ?? "",
      createdAt: row.created_at,
    };
  });

  if (dbRow) {
    return dbRow;
  }

  return readRunIndexFile().find((record) => record.runId === runId) ?? null;
}

async function updateRunStatus(runId: string, status: string): Promise<void> {
  const dbUpdated = await withDatabase(async (client) => {
    await client.query(`update runs set status = $2 where run_id = $1`, [runId, status]);
    return true;
  });

  if (dbUpdated) {
    return;
  }

  const records = readRunIndexFile();
  const index = records.findIndex((record) => record.runId === runId);
  if (index >= 0) {
    records[index].status = status;
    writeRunIndexFile(records);
  }
}

function readRunIndexFile(): RunRecord[] {
  if (!existsSync(runIndexPath)) {
    return [];
  }

  try {
    const raw = readFileSync(runIndexPath, "utf8");
    const parsed = JSON.parse(raw) as RunRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRunIndexFile(records: RunRecord[]): void {
  mkdirSync(dirname(runIndexPath), { recursive: true });
  writeFileSync(runIndexPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // no-op: server boot is module top-level
}
