import { scanForLeaks } from "../utils/leakScan.js";

export interface GeminiMessage {
  role: string;
  content: string;
}

export interface InvokeGeminiArgs {
  model: string;
  messages: GeminiMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface InvokeGeminiResult {
  outputText: string;
  raw?: {
    finishReason?: string;
    modelVersion?: string;
    usageMetadata?: unknown;
  };
}

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiPayload {
  contents: GeminiContent[];
  generationConfig: {
    maxOutputTokens: number;
    temperature?: number;
  };
}

export function mapMessagesToGeminiPayload(input: {
  messages: GeminiMessage[];
  maxTokens: number;
  temperature?: number;
}): GeminiPayload {
  const contents: GeminiContent[] = input.messages.map((message) => ({
    role: message.role.toLowerCase() === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const generationConfig: GeminiPayload["generationConfig"] = {
    maxOutputTokens: input.maxTokens,
  };

  if (typeof input.temperature === "number") {
    generationConfig.temperature = input.temperature;
  }

  return {
    contents,
    generationConfig,
  };
}

export function parseGeminiResponseText(response: unknown): {
  outputText: string;
  finishReason?: string;
  modelVersion?: string;
  usageMetadata?: unknown;
} {
  const record = toRecord(response);
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  const firstCandidate = toRecord(candidates[0]);

  const parts = Array.isArray(toRecord(firstCandidate?.content)?.parts)
    ? (toRecord(firstCandidate?.content)?.parts as unknown[])
    : [];

  const outputText = parts
    .map((entry) => toRecord(entry))
    .map((entry) => (typeof entry?.text === "string" ? entry.text : ""))
    .filter((text) => text.length > 0)
    .join("\n")
    .trim();

  const finishReason = asString(firstCandidate?.finishReason);
  const modelVersion = asString(record?.modelVersion);

  return {
    outputText,
    finishReason,
    modelVersion,
    usageMetadata: record?.usageMetadata,
  };
}

export async function invokeGeminiLLM(args: InvokeGeminiArgs): Promise<InvokeGeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required when provider=gemini.");
  }

  const maxTokens = args.maxTokens ?? Number(process.env.GEMINI_MAX_TOKENS ?? "1024");
  const temperature =
    typeof args.temperature === "number"
      ? args.temperature
      : process.env.GEMINI_TEMPERATURE
        ? Number(process.env.GEMINI_TEMPERATURE)
        : undefined;

  const payload = mapMessagesToGeminiPayload({
    messages: args.messages,
    maxTokens,
    temperature,
  });

  const baseUrl = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
  const endpoint = new URL(
    `/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    baseUrl
  ).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Gemini request failed: timeout after 30s");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();
  const responseJson = safeJson(responseText);

  if (!response.ok) {
    const errorRecord = toRecord(toRecord(responseJson)?.error);
    const message = asString(errorRecord?.message) ?? responseText.slice(0, 500);
    throw new Error(`Gemini request failed (${response.status}): ${message}`);
  }

  const parsed = parseGeminiResponseText(responseJson);
  if (!parsed.outputText) {
    const reason = parsed.finishReason ?? "unknown";
    throw new Error(`Gemini response blocked or empty (provider=gemini, finishReason=${reason}).`);
  }

  const minimalRaw = {
    finishReason: parsed.finishReason,
    modelVersion: parsed.modelVersion,
    usageMetadata: parsed.usageMetadata,
  };

  const leakCheck = scanForLeaks(
    [{ field: "geminiResponseRaw", value: minimalRaw }],
    [apiKey]
  );

  return {
    outputText: parsed.outputText,
    raw: leakCheck.ok ? minimalRaw : undefined,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
