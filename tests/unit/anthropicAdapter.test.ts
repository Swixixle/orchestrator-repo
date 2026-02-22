import { describe, expect, it } from "vitest";
import {
  mapMessagesToAnthropicPayload,
  parseAnthropicResponseText,
} from "../../src/adapters/anthropicAdapter.js";

describe("anthropic adapter", () => {
  it("maps orchestrator messages into anthropic payload with system field", () => {
    const payload = mapMessagesToAnthropicPayload({
      model: "claude-3-5-sonnet-20241022",
      maxTokens: 512,
      temperature: 0.2,
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Explain tides." },
        { role: "assistant", content: "They are driven by gravity." },
      ],
    });

    expect(payload.model).toBe("claude-3-5-sonnet-20241022");
    expect(payload.max_tokens).toBe(512);
    expect(payload.temperature).toBe(0.2);
    expect(payload.system).toBe("Be concise.");
    expect(payload.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Explain tides." }] },
      { role: "assistant", content: [{ type: "text", text: "They are driven by gravity." }] },
    ]);
  });

  it("parses anthropic text blocks in order", () => {
    const output = parseAnthropicResponseText({
      id: "msg_123",
      content: [
        { type: "text", text: "Line one." },
        { type: "tool_use", name: "ignored" },
        { type: "text", text: "Line two." },
      ],
    });

    expect(output).toBe("Line one.\nLine two.");
  });
});
