import { describe, expect, it } from "vitest";
import {
  mapMessagesToGeminiPayload,
  parseGeminiResponseText,
} from "../../src/adapters/geminiAdapter.js";

describe("gemini adapter", () => {
  it("maps orchestrator messages into gemini payload", () => {
    const payload = mapMessagesToGeminiPayload({
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Explain tides." },
        { role: "assistant", content: "They are driven by gravity." },
      ],
      maxTokens: 256,
      temperature: 0.2,
    });

    expect(payload.generationConfig.maxOutputTokens).toBe(256);
    expect(payload.generationConfig.temperature).toBe(0.2);
    expect(payload.contents).toEqual([
      { role: "user", parts: [{ text: "Be concise." }] },
      { role: "user", parts: [{ text: "Explain tides." }] },
      { role: "model", parts: [{ text: "They are driven by gravity." }] },
    ]);
  });

  it("parses gemini text parts in order", () => {
    const output = parseGeminiResponseText({
      modelVersion: "gemini-1.5-flash",
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: "Line one." }, { text: "Line two." }],
          },
        },
      ],
    });

    expect(output.outputText).toBe("Line one.\nLine two.");
    expect(output.finishReason).toBe("STOP");
    expect(output.modelVersion).toBe("gemini-1.5-flash");
  });
});
