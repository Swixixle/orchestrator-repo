#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { runPipeline } from "../orchestrator.js";
import { runVerify } from "../cli/verify.js";
import { scanForLeaks } from "../utils/leakScan.js";
import { invokeLLMWithHaloAdapter } from "../adapters/haloReceiptsAdapter.js";
import { invokeAnthropicLLM } from "../adapters/anthropicAdapter.js";

const require = createRequire(import.meta.url);
const express = require("express") as typeof import("express");
const { Client } = require("pg") as typeof import("pg");
const packageJson = require("../../package.json") as { version?: string };

const app = express();
const host = process.env.CONSOLE_HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? process.env.CONSOLE_PORT ?? "8080");
const uiDist = resolve(process.env.CONSOLE_UI_DIST_DIR ?? "ui/dist");

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req: Request, res: Response) => {
  const db = await checkDatabase();
  const uiPathResolvable = existsSync(uiDist);
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
    ui_path_resolvable: uiPathResolvable,
    ready:
      db.status !== "fail" &&
      uiPathResolvable &&
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
        (v): v is string => typeof v === "string" && v.length > 0
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
    };
    const artifactContent = `${JSON.stringify(artifactPayload, null, 2)}\n`;
    const contentHash = sha256Hex(artifactContent);

    writeFileSync(
      artifactPath,
      artifactContent,
      "utf8"
    );

    await upsertRunIndex({
      runId,
      provider,
      model,
      status: "created",
      contentHash,
      artifactDir: outDir,
    });

    res.json({
      ok: true,
      run_id: runId,
      provider,
      model,
      artifactPath,
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
    if (!artifactPath) {
      res.status(400).json({ ok: false, error: "artifactPath is required" });
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

app.post("/api/tamper", async (req: Request, res: Response) => {
  await handleTamperRequest(req, res);
});

app.post("/api/runs/:id/tamper", async (req: Request, res: Response) => {
  req.body = { ...(req.body ?? {}), run_id: req.params.id };
  await handleTamperRequest(req, res);
});

async function handleTamperRequest(req: Request, res: Response): Promise<void> {
  try {
    const runId = stringOrDefault(req.body?.run_id, "");
    const artifactPathFromBody = stringOrDefault(req.body?.artifactPath, "");

    if (!runId && !artifactPathFromBody) {
      res.status(400).json({ ok: false, error: "run_id or artifactPath is required" });
      return;
    }

    const dbRecord = runId ? await getRunIndex(runId) : null;
    const artifactPath = artifactPathFromBody
      ? resolve(artifactPathFromBody)
      : resolve(join(dbRecord?.artifactDir ?? "", `${runId}.console_artifact.json`));

    if (!existsSync(artifactPath)) {
      res.status(404).json({ ok: false, error: `artifact not found at ${artifactPath}` });
      return;
    }

    const originalContent = readFileSync(artifactPath, "utf8");
    const originalObject = JSON.parse(originalContent) as {
      outputText?: unknown;
      prompt?: unknown;
    };

    if (typeof originalObject.outputText === "string" && originalObject.outputText.length > 0) {
      const first = originalObject.outputText[0];
      const replacement = first === "X" ? "Y" : "X";
      originalObject.outputText = `${replacement}${originalObject.outputText.slice(1)}`;
    } else {
      originalObject.prompt = `${String(originalObject.prompt ?? "")} [tampered]`;
    }

    const tamperedContent = `${JSON.stringify(originalObject, null, 2)}\n`;
    writeFileSync(artifactPath, tamperedContent, "utf8");

    const expectedHash = dbRecord?.contentHash ?? sha256Hex(originalContent);
    const computedHash = sha256Hex(tamperedContent);
    const verificationStatus = expectedHash === computedHash ? "VALID" : "INVALID";

    if (runId) {
      await updateRunStatus(runId, "tampered");
    }

    res.json({
      ok: true,
      run_id: runId || null,
      artifactPath,
      verification: {
        status: verificationStatus,
        expected_hash: expectedHash,
        computed_hash: computedHash,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
}

app.post("/api/leak-scan", (req: Request, res: Response) => {
  try {
    const payload = req.body ?? {};
    const result = scanForLeaks([
      { field: "payload", value: payload },
    ]);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

if (existsSync(uiDist)) {
  app.use(express.static(uiDist));
  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(join(uiDist, "index.html"));
  });
}

app.listen(port, host, () => {
  console.log(`HALO Console Server listening on http://${host}:${port}`);
  if (existsSync(uiDist)) {
    console.log(`Serving UI from ${uiDist}`);
  } else {
    console.log(`UI dist not found at ${uiDist}; API mode only.`);
  }
});

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
      created_at timestamptz not null default now(),
      artifact_dir text not null
    )
  `);
}

async function upsertRunIndex(entry: {
  runId: string;
  provider: string;
  model: string;
  status: string;
  contentHash: string;
  artifactDir: string;
}): Promise<void> {
  await withDatabase(async (client) => {
    await client.query(
      `
      insert into runs (run_id, provider, model, status, content_hash, artifact_dir)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (run_id)
      do update set
        provider = excluded.provider,
        model = excluded.model,
        status = excluded.status,
        content_hash = excluded.content_hash,
        artifact_dir = excluded.artifact_dir
    `,
      [
        entry.runId,
        entry.provider,
        entry.model,
        entry.status,
        entry.contentHash,
        entry.artifactDir,
      ]
    );
  });
}

async function getRunIndex(
  runId: string
): Promise<{ contentHash: string; artifactDir: string } | null> {
  const row = await withDatabase(async (client) => {
    const result = await client.query<{ content_hash: string; artifact_dir: string }>(
      `select content_hash, artifact_dir from runs where run_id = $1`,
      [runId]
    );
    return result.rows[0] ?? null;
  });

  if (!row) {
    return null;
  }

  return {
    contentHash: row.content_hash,
    artifactDir: row.artifact_dir,
  };
}

async function updateRunStatus(runId: string, status: string): Promise<void> {
  await withDatabase(async (client) => {
    await client.query(`update runs set status = $2 where run_id = $1`, [runId, status]);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // no-op: server boot is module top-level
}
