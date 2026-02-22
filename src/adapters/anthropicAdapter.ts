import { scanForLeaks } from "../utils/leakScan.js";

export interface ChatMessage {
  role: string;
  content: string;
}

export interface InvokeAnthropicArgs {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface InvokeAnthropicResult {
  outputText: string;
  raw?: {
    id?: string;
    model?: string;
    stop_reason?: string;
    usage?: unknown;
  };
}

interface AnthropicRequestMessage {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
}

interface AnthropicPayload {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string;
  messages: AnthropicRequestMessage[];
}

export function mapMessagesToAnthropicPayload(input: {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
}): AnthropicPayload {
  const systemChunks: string[] = [];
  const requestMessages: AnthropicRequestMessage[] = [];

  for (const message of input.messages) {
    const role = message.role.toLowerCase();
    if (role === "system") {
      systemChunks.push(message.content);
      continue;
    }

    const mappedRole: "user" | "assistant" = role === "assistant" ? "assistant" : "user";
    requestMessages.push({
      role: mappedRole,
      content: [{ type: "text", text: message.content }],
    });
  }

  const payload: AnthropicPayload = {
    model: input.model,
    max_tokens: input.maxTokens,
    messages: requestMessages,
  };

  if (typeof input.temperature === "number") {
    payload.temperature = input.temperature;
  }

  if (systemChunks.length > 0) {
    payload.system = systemChunks.join("\n\n");
  }

  return payload;
}

export function parseAnthropicResponseText(response: unknown): string {
  const record = toRecord(response);
  const blocks = Array.isArray(record?.content) ? record?.content : [];
  const textBlocks = blocks
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => entry.type === "text")
    .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
    .filter((text) => text.length > 0);

  return textBlocks.join("\n").trim();
}

export async function invokeAnthropicLLM(args: InvokeAnthropicArgs): Promise<InvokeAnthropicResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when provider=anthropic.");
  }

  const maxTokens = args.maxTokens ?? Number(process.env.ANTHROPIC_MAX_TOKENS ?? "1024");
  const temperature =
    typeof args.temperature === "number"
      ? args.temperature
      : process.env.ANTHROPIC_TEMPERATURE
        ? Number(process.env.ANTHROPIC_TEMPERATURE)
        : undefined;

  const payload = mapMessagesToAnthropicPayload({
    model: args.model,
    messages: args.messages,
    maxTokens,
    temperature,
  });

  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
  const endpoint = new URL("/v1/messages", baseUrl).toString();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  const responseJson = safeJson(responseText);

  if (!response.ok) {
    const message = toRecord(responseJson)?.error;
    throw new Error(
      `Anthropic request failed (${response.status}): ${
        typeof message === "string" ? message : responseText.slice(0, 500)
      }`
    );
  }

  const outputText = parseAnthropicResponseText(responseJson);
  if (!outputText) {
    throw new Error("Anthropic response contained no assistant text blocks.");
  }

  const minimalRaw = {
    id: asString(toRecord(responseJson)?.id),
    model: asString(toRecord(responseJson)?.model),
    stop_reason: asString(toRecord(responseJson)?.stop_reason),
    usage: toRecord(responseJson)?.usage,
  };

  const leakCheck = scanForLeaks(
    [{ field: "anthropicResponseRaw", value: minimalRaw }],
    [apiKey]
  );

  return {
    outputText,
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
