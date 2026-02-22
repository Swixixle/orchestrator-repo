#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response, NextFunction } from "express";
import { runPipeline } from "../orchestrator.js";
import { runVerify } from "../cli/verify.js";
import { scanForLeaks } from "../utils/leakScan.js";
import { invokeLLMWithHaloAdapter } from "../adapters/haloReceiptsAdapter.js";
import { invokeAnthropicLLM } from "../adapters/anthropicAdapter.js";

const require = createRequire(import.meta.url);
const express = require("express") as typeof import("express");
const { Client } = require("pg") as typeof import("pg");

const app = express();
const host = process.env.CONSOLE_HOST ?? "0.0.0.0";
const port = Number(process.env.CONSOLE_PORT ?? "8090");
const uiDist = resolve(process.env.CONSOLE_UI_DIST_DIR ?? "ui/dist");

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req: Request, res: Response) => {
  const db = await checkDatabase();
  res.json({
    ok: true,
    service: "halo-console",
    database: db,
    timestamp: new Date().toISOString(),
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
    const artifactPath = join(outDir, "console_artifact.json");
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          provider,
          model,
          prompt,
          outputText: pipelineResult.llmResponse,
          receipt: pipelineResult.receipt,
          verification: pipelineResult.verification,
          ledger: pipelineResult.ledger,
          semanticValidation: pipelineResult.validation,
          leakScan,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    res.json({
      ok: true,
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

async function checkDatabase(): Promise<{ ok: boolean; detail: string }> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { ok: false, detail: "DATABASE_URL not configured" };
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("select 1");
    return { ok: true, detail: "connected" };
  } catch (error) {
    return { ok: false, detail: formatError(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // no-op: server boot is module top-level
}
