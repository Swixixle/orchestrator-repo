#!/usr/bin/env node
/**
 * Demo CLI – run the full HALO + ELI pipeline and write artifact files.
 *
 * Usage:
 *   npm run demo -- --prompt "Tell me about ocean tides."
 *   npm run demo -- --input-file path/to/prompt.txt --model gpt-4o --out-dir out
 *
 * Required environment variable (live LLM path):
 *   OPENAI_API_KEY  – provider credential; never written to any output file
 *
 * Optional environment variables:
 *   E2E_MODEL       – model name (default: "gpt-4.1-mini")
 *   E2E_ENDPOINT    – "/chat/completions" (default) or "/responses"
 *
 * Output files written to <out-dir>/ (default: out/):
 *   artifact.json   – full machine-readable truth object
 *   receipt.json    – HALO receipt only
 *   transcript.json – signed transcript object only
 *   ledger.json     – ELI ledger only
 *   report.md       – human-readable summary
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  invokeLLMWithHaloAdapter,
  signHaloTranscriptAdapter,
} from "../adapters/haloReceiptsAdapter.js";
import { invokeAnthropicLLM } from "../adapters/anthropicAdapter.js";
import { tagResponseToLedger, validateLedgerSemantics } from "../adapters/eliAdapter.js";
import { scanForLeaks } from "../utils/leakScan.js";
import type { Artifact } from "../types/artifact.js";

type DemoProvider = "openai" | "anthropic";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  prompt?: string;
  inputFile?: string;
  provider: DemoProvider;
  model: string;
  endpoint: "/chat/completions" | "/responses";
  maxTokens?: number;
  outDir: string;
} {
  const args = argv.slice(2);
  let prompt: string | undefined;
  let inputFile: string | undefined;
  let provider = (process.env.LLM_PROVIDER as DemoProvider | undefined) ?? "openai";
  let model = process.env.E2E_MODEL ?? "gpt-4.1-mini";
  let endpoint: "/chat/completions" | "/responses" =
    (process.env.E2E_ENDPOINT as "/chat/completions" | "/responses") ?? "/chat/completions";
  let maxTokens: number | undefined;
  let outDir = "out";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--prompt" && args[i + 1]) {
      prompt = args[++i];
    } else if (arg === "--input-file" && args[i + 1]) {
      inputFile = args[++i];
    } else if (arg === "--provider" && args[i + 1]) {
      const p = args[++i] as string;
      if (p !== "openai" && p !== "anthropic") {
        throw new Error(`--provider must be "openai" or "anthropic", got: ${p}`);
      }
      provider = p;
    } else if (arg === "--model" && args[i + 1]) {
      model = args[++i];
    } else if (arg === "--endpoint" && args[i + 1]) {
      const ep = args[++i] as string;
      if (ep !== "/chat/completions" && ep !== "/responses") {
        throw new Error(`--endpoint must be "/chat/completions" or "/responses", got: ${ep}`);
      }
      endpoint = ep;
    } else if (arg === "--max-tokens" && args[i + 1]) {
      const parsed = Number(args[++i]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--max-tokens must be a positive number, got: ${String(parsed)}`);
      }
      maxTokens = parsed;
    } else if (arg === "--out-dir" && args[i + 1]) {
      outDir = args[++i];
    }
  }

  return { prompt, inputFile, provider, model, endpoint, maxTokens, outDir };
}

function resolvePrompt(opts: { prompt?: string; inputFile?: string }): string {
  if (opts.prompt) return opts.prompt;
  if (opts.inputFile) {
    const p = resolve(opts.inputFile);
    if (!existsSync(p)) throw new Error(`--input-file not found: ${p}`);
    return readFileSync(p, "utf8").trim();
  }
  throw new Error("Provide --prompt or --input-file.");
}

function getOrchestratorVersion(): string {
  try {
    // Resolve package.json relative to this file's location
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const require = createRequire(import.meta.url);
    // Walk up from src/cli/ to find package.json
    const pkgPath = resolve(__dirname, "../../package.json");
    const pkg = require(pkgPath) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function buildReport(artifact: Artifact, promptText: string): string {
  const { meta, llm, eliValidation, eliLedger, security, provenance } = artifact;

  const leakStatus = security.credentialLeakScan.ok
    ? "✅ PASS (no credential patterns found)"
    : `❌ FAIL – findings:\n${security.credentialLeakScan.findings.map((f) => `  - ${f.location}: ${f.pattern}`).join("\n")}`;

  const validationStatus = eliValidation.ok
    ? "✅ PASS (no ERROR issues)"
    : `❌ FAIL – issues:\n${eliValidation.issues.map((i) => `  - [${i.severity}] ${i.claimId}: ${i.rule} – ${i.detail}`).join("\n")}`;

  const factOrInference = eliLedger.claims.filter(
    (c) => c.type === "FACT" || c.type === "INFERENCE"
  ).length;

  const provenanceSection = provenance.provenanceHash
    ? `**Provenance hash:** \`${provenance.provenanceHash}\``
    : "_Provenance hash not returned by this provider/endpoint._";

  return `# Orchestrator Demo Report

## Run metadata
- **Timestamp:** ${meta.timestamp}
- **Orchestrator version:** ${meta.orchestratorVersion}
- **Node version:** ${meta.nodeVersion}

## LLM call
- **Provider:** ${llm.provider}
- **Endpoint:** ${llm.endpoint}
- **Model:** ${llm.model}

## Prompt
\`\`\`
${promptText}
\`\`\`

## Provenance
${provenanceSection}

## ELI Ledger summary
- **Claims:** ${eliLedger.claims.length}
- **FACT / INFERENCE:** ${factOrInference}
- **Tagged at:** ${eliLedger.tagged_at}

## Semantic validation
${validationStatus}

## Credential leak scan
${leakStatus}

## Output files
| File | Contents |
|------|----------|
| \`artifact.json\` | Full machine-readable truth object |
| \`receipt.json\` | HALO receipt only |
| \`transcript.json\` | Signed transcript only |
| \`ledger.json\` | ELI ledger only |
| \`report.md\` | This file |

---
_Run \`npm run verify -- --artifact out/artifact.json\` to verify offline._
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runDemo(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  const promptText = resolvePrompt(opts);

  ensureProviderKey(opts.provider);

  console.log(`[demo] Invoking LLM via provider adapter...`);
  console.log(`[demo]   provider : ${opts.provider}`);
  console.log(`[demo]   endpoint : ${opts.endpoint}`);
  console.log(`[demo]   model    : ${opts.model}`);

  const messages = [{ role: "user", content: promptText }];

  const adapterResult =
    opts.provider === "anthropic"
      ? await invokeAnthropicWithHalo(opts.model, messages, opts.maxTokens)
      : await invokeLLMWithHaloAdapter({
          endpoint: opts.endpoint,
          model: opts.model,
          promptOrMessages: promptText,
        });

  console.log("[demo] LLM responded. Running ELI tagging...");

  const ledger = tagResponseToLedger(adapterResult.outputText);
  const validation = validateLedgerSemantics(ledger, adapterResult.outputText);

  const leakScan = scanForLeaks(
    [
      { field: "transcript", value: adapterResult.transcript },
      { field: "haloReceipt", value: adapterResult.haloReceipt },
      { field: "provenance", value: adapterResult.provenance },
    ],
    [process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY].filter(
      (v): v is string => typeof v === "string"
    )
  );

  const provenance = adapterResult.provenance as Record<string, unknown>;

  const artifact: Artifact = {
    meta: {
      timestamp: new Date().toISOString(),
      orchestratorVersion: getOrchestratorVersion(),
      nodeVersion: process.version,
    },
    llm: {
      provider: opts.provider,
      endpoint: opts.provider === "anthropic" ? "/v1/messages" : opts.endpoint,
      model: opts.model,
      // Only proven request params – no Authorization headers
      requestParams: {
        model: opts.model,
        endpoint: opts.provider === "anthropic" ? "/v1/messages" : opts.endpoint,
        provider: opts.provider,
        maxTokens: opts.maxTokens,
      },
    },
    transcript: adapterResult.transcript,
    haloReceipt: adapterResult.haloReceipt,
    provenance: {
      provenanceHash:
        typeof provenance.provenance_hash === "string"
          ? provenance.provenance_hash
          : undefined,
      raw: provenance,
    },
    eliLedger: ledger,
    eliValidation: validation,
    security: { credentialLeakScan: leakScan },
  };

  // Write output files
  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });

  writeFileSync(resolve(outDir, "artifact.json"), JSON.stringify(artifact, null, 2), "utf8");
  writeFileSync(resolve(outDir, "receipt.json"), JSON.stringify(artifact.haloReceipt, null, 2), "utf8");
  writeFileSync(resolve(outDir, "transcript.json"), JSON.stringify(artifact.transcript, null, 2), "utf8");
  writeFileSync(resolve(outDir, "ledger.json"), JSON.stringify(artifact.eliLedger, null, 2), "utf8");
  writeFileSync(resolve(outDir, "report.md"), buildReport(artifact, promptText), "utf8");

  console.log(`\n[demo] ✅ Artifacts written to ${outDir}/`);
  console.log(`[demo]   artifact.json`);
  console.log(`[demo]   receipt.json`);
  console.log(`[demo]   transcript.json`);
  console.log(`[demo]   ledger.json`);
  console.log(`[demo]   report.md`);

  if (!leakScan.ok) {
    console.error("\n[demo] ⚠️  CREDENTIAL LEAK SCAN FAILED – review artifact before sharing.");
    console.error(leakScan.findings.map((f) => `  - ${f.location}: ${f.pattern}`).join("\n"));
    process.exit(1);
  }
}

async function invokeAnthropicWithHalo(
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens?: number
): Promise<{
  outputText: string;
  transcript: unknown;
  haloReceipt: unknown;
  provenance: Record<string, unknown>;
}> {
  const anthropicResult = await invokeAnthropicLLM({ model, messages, maxTokens });

  const transcript = {
    provider: "anthropic",
    endpoint: "/v1/messages",
    model,
    messages,
    output_text: anthropicResult.outputText,
  };

  const haloReceipt = await signHaloTranscriptAdapter(transcript);
  return {
    outputText: anthropicResult.outputText,
    transcript,
    haloReceipt,
    provenance: {
      provider: "anthropic",
      ...(anthropicResult.raw ?? {}),
    },
  };
}

function ensureProviderKey(provider: DemoProvider): void {
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is required when provider=openai.\n" +
        "  Export it in your shell and re-run:\n" +
        "    OPENAI_API_KEY=sk-... npm run demo -- --provider openai --prompt '...'"
    );
  }

  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required when provider=anthropic.\n" +
        "  Export it in your shell and re-run:\n" +
        "    ANTHROPIC_API_KEY=... npm run demo -- --provider anthropic --prompt '...'"
    );
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

// Only run when invoked directly (not imported by tests)
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runDemo(process.argv).catch((err: unknown) => {
    console.error("[demo] ERROR:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
