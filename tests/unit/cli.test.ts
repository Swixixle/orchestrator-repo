/**
 * Unit tests for CLI utilities – no network, no real LLM, no halo-receipts.
 *
 * Covers:
 *   1. leakScan utility
 *   2. Artifact type shape (compile-time + runtime check)
 *   3. verify CLI argument parsing and report building
 *   4. run CLI argument parsing
 */
import { describe, it, expect } from "vitest";
import { scanForLeaks } from "../../src/utils/leakScan.js";
import type { Artifact } from "../../src/types/artifact.js";
import { tagResponse } from "../../src/eli/tagger.js";
import { validateLedger } from "../../src/eli/validator.js";

// ── 1. leakScan ───────────────────────────────────────────────────────────────

describe("scanForLeaks", () => {
  it("returns ok=true when no credential patterns are present", () => {
    const result = scanForLeaks([
      { field: "transcript", value: { model: "gpt-4o", content: "Ocean tides are caused by gravity." } },
      { field: "receipt", value: { id: "abc123", hash: "deadbeef" } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("detects Bearer token in a nested object", () => {
    const result = scanForLeaks([
      { field: "transcript", value: { headers: { Authorization: "Bearer sk-abc123456789" } } },
    ]);

    expect(result.ok).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].location).toBe("transcript");
  });

  it("detects OpenAI sk- key prefix", () => {
    const result = scanForLeaks([
      { field: "receipt", value: "some text sk-proj-ABCDEFGHIJKLMNO rest of text" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.pattern.includes("sk-"))).toBe(true);
  });

  it("detects literal API key supplied via extraPatterns", () => {
    const apiKey = "my-super-secret-key-value-12345";
    const result = scanForLeaks(
      [{ field: "provenance", value: { data: `contains ${apiKey} in it` } }],
      [apiKey]
    );

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.pattern === "API key (literal)")).toBe(true);
  });

  it("ignores short extra patterns (< 8 chars)", () => {
    const result = scanForLeaks(
      [{ field: "data", value: "short" }],
      ["abc"]  // too short to add
    );

    expect(result.ok).toBe(true);
  });

  it("handles non-serialisable values gracefully", () => {
    // Circular reference cannot be JSON.stringified
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => {
      scanForLeaks([{ field: "circular", value: circular }]);
    }).not.toThrow();

    const result = scanForLeaks([{ field: "circular", value: circular }]);
    // The serialisation error finding should be present
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].location).toBe("circular");
  });

  it("handles plain string values", () => {
    const result = scanForLeaks([{ field: "text", value: "This is a normal sentence." }]);
    expect(result.ok).toBe(true);
  });
});

// ── 2. Artifact type shape ────────────────────────────────────────────────────

describe("Artifact type shape", () => {
  it("can construct a valid Artifact object at runtime", () => {
    const TEXT =
      "Ocean tides are caused by the gravitational pull of the Moon and Sun. " +
      "This suggests that tides are stronger when the Moon is closer.";

    const ledger = tagResponse(TEXT);
    const rawValidation = validateLedger(ledger, TEXT);
    const validation = {
      ok: rawValidation.passed,
      issues: rawValidation.violations.map((v) => ({
        claimId: v.claimId,
        rule: v.rule,
        detail: v.detail,
        severity: "ERROR" as const,
      })),
    };
    const leakScan = scanForLeaks([{ field: "transcript", value: { model: "test" } }]);

    const artifact: Artifact = {
      meta: {
        timestamp: new Date().toISOString(),
        orchestratorVersion: "1.0.0",
        nodeVersion: process.version,
      },
      llm: {
        provider: "openai",
        endpoint: "/chat/completions",
        model: "gpt-4.1-mini",
        requestParams: { model: "gpt-4.1-mini" },
      },
      transcript: { model: "gpt-4.1-mini", messages: [] },
      haloReceipt: { id: "receipt-001", ts: "2024-01-01T00:00:00Z" },
      provenance: { provenanceHash: "abc123def456" },
      eliLedger: ledger,
      eliValidation: validation,
      security: { credentialLeakScan: leakScan },
    };

    expect(artifact.meta.orchestratorVersion).toBe("1.0.0");
    expect(artifact.llm.endpoint).toBe("/chat/completions");
    expect(artifact.eliLedger.claims.length).toBeGreaterThan(0);
    expect(artifact.security.credentialLeakScan.ok).toBe(true);
  });

  it("provenance hash field is optional", () => {
    const leakScan = scanForLeaks([]);
    const ledger = tagResponse("Test sentence.");
    const rawValidation = validateLedger(ledger, "Test sentence.");
    const validation = {
      ok: rawValidation.passed,
      issues: rawValidation.violations.map((v) => ({
        claimId: v.claimId,
        rule: v.rule,
        detail: v.detail,
        severity: "ERROR" as const,
      })),
    };

    const artifact: Artifact = {
      meta: { timestamp: "", orchestratorVersion: "", nodeVersion: "" },
      llm: { provider: "", endpoint: "/chat/completions", model: "", requestParams: {} },
      transcript: {},
      haloReceipt: {},
      provenance: {},  // no provenanceHash
      eliLedger: ledger,
      eliValidation: validation,
      security: { credentialLeakScan: leakScan },
    };

    expect(artifact.provenance.provenanceHash).toBeUndefined();
  });
});

// ── 3. Verify CLI – argument parsing ─────────────────────────────────────────

describe("verify CLI argument parsing", () => {
  // Test the parsing logic inline (matches parseArgs in verify.ts)
  function parseVerifyArgs(argv: string[]): { artifactPath: string; outDir: string } {
    const args = argv.slice(2);
    let artifactPath: string | undefined;
    let outDir = "out";

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if ((arg === "--artifact" || arg === "-a") && args[i + 1]) {
        artifactPath = args[++i];
      } else if (arg === "--out-dir" && args[i + 1]) {
        outDir = args[++i];
      }
    }

    if (!artifactPath) {
      throw new Error("Provide --artifact <path>.");
    }

    return { artifactPath, outDir };
  }

  it("parses --artifact flag", () => {
    const opts = parseVerifyArgs(["node", "verify.ts", "--artifact", "out/artifact.json"]);
    expect(opts.artifactPath).toContain("artifact.json");
    expect(opts.outDir).toBe("out");
  });

  it("parses -a short form", () => {
    const opts = parseVerifyArgs(["node", "verify.ts", "-a", "out/artifact.json"]);
    expect(opts.artifactPath).toContain("artifact.json");
  });

  it("parses --out-dir flag", () => {
    const opts = parseVerifyArgs(["node", "verify.ts", "--artifact", "a.json", "--out-dir", "results"]);
    expect(opts.outDir).toBe("results");
  });

  it("throws when --artifact is missing", () => {
    expect(() => parseVerifyArgs(["node", "verify.ts"])).toThrow("Provide --artifact");
  });
});

// ── 4. Demo CLI – argument parsing ───────────────────────────────────────────

describe("demo CLI argument parsing", () => {
  // Test the parsing logic inline (matches parseArgs in run.ts)
  function parseDemoArgs(argv: string[]): {
    prompt?: string;
    inputFile?: string;
    provider: "openai" | "anthropic";
    model: string;
    endpoint: "/chat/completions" | "/responses";
    maxTokens?: number;
    outDir: string;
  } {
    const args = argv.slice(2);
    let prompt: string | undefined;
    let inputFile: string | undefined;
    let provider: "openai" | "anthropic" = "openai";
    let model = "gpt-4.1-mini";
    let endpoint: "/chat/completions" | "/responses" = "/chat/completions";
    let maxTokens: number | undefined;
    let outDir = "out";

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--prompt" && args[i + 1]) {
        prompt = args[++i];
      } else if (arg === "--input-file" && args[i + 1]) {
        inputFile = args[++i];
      } else if (arg === "--provider" && args[i + 1]) {
        const providerValue = args[++i];
        if (providerValue !== "openai" && providerValue !== "anthropic") {
          throw new Error(`--provider must be \"openai\" or \"anthropic\", got: ${providerValue}`);
        }
        provider = providerValue;
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

  it("parses --prompt flag", () => {
    const opts = parseDemoArgs(["node", "run.ts", "--prompt", "Hello world"]);
    expect(opts.prompt).toBe("Hello world");
    expect(opts.provider).toBe("openai");
    expect(opts.model).toBe("gpt-4.1-mini");
    expect(opts.endpoint).toBe("/chat/completions");
    expect(opts.outDir).toBe("out");
  });

  it("parses --provider anthropic flag", () => {
    const opts = parseDemoArgs([
      "node",
      "run.ts",
      "--prompt",
      "test",
      "--provider",
      "anthropic",
      "--model",
      "claude-3-5-sonnet-20241022",
    ]);
    expect(opts.provider).toBe("anthropic");
    expect(opts.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("parses --max-tokens flag", () => {
    const opts = parseDemoArgs([
      "node",
      "run.ts",
      "--prompt",
      "test",
      "--max-tokens",
      "256",
    ]);
    expect(opts.maxTokens).toBe(256);
  });

  it("parses --model flag", () => {
    const opts = parseDemoArgs(["node", "run.ts", "--prompt", "test", "--model", "gpt-4o"]);
    expect(opts.model).toBe("gpt-4o");
  });

  it("parses --endpoint /responses", () => {
    const opts = parseDemoArgs(["node", "run.ts", "--prompt", "test", "--endpoint", "/responses"]);
    expect(opts.endpoint).toBe("/responses");
  });

  it("parses --out-dir flag", () => {
    const opts = parseDemoArgs(["node", "run.ts", "--prompt", "test", "--out-dir", "results"]);
    expect(opts.outDir).toBe("results");
  });

  it("parses --input-file flag", () => {
    const opts = parseDemoArgs(["node", "run.ts", "--input-file", "prompt.txt"]);
    expect(opts.inputFile).toBe("prompt.txt");
    expect(opts.prompt).toBeUndefined();
  });

  it("throws on invalid --endpoint value", () => {
    expect(() =>
      parseDemoArgs(["node", "run.ts", "--prompt", "test", "--endpoint", "/invalid"])
    ).toThrow("--endpoint must be");
  });

  it("throws on invalid --provider value", () => {
    expect(() =>
      parseDemoArgs(["node", "run.ts", "--prompt", "test", "--provider", "bad"])
    ).toThrow("--provider must be");
  });
});
