/**
 * HALO Receipts Adapter – delegates entirely to the halo-receipts package.
 *
 * No local crypto. All signing and verification is performed by halo-receipts.
 * If the package is unavailable, functions throw with a clear message.
 *
 * Install halo-receipts for E2E:
 *   npm install github:Swixixle/HALO-RECEIPTS#main
 *
 * Environment variables (all required when RUN_E2E=1):
 *   OPENAI_API_KEY        – provider credential (never included in receipt)
 *   RECEIPT_SIGNING_KEY   – signing key for halo-receipts
 *   RECEIPT_KEY_ID        – key identifier for halo-receipts (if required)
 *   E2E_ENDPOINT          – "/chat/completions" (default) or "/responses"
 *   E2E_MODEL             – model name (default: "gpt-4.1-mini")
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface InvokeLLMWithHaloArgs {
  endpoint: "/chat/completions" | "/responses";
  model: string;
  promptOrMessages: string | Array<{ role: string; content: string }>;
}

export interface InvokeLLMWithHaloResult {
  outputText: string;
  provenance: unknown;
  haloReceipt: unknown;
  /** The exact transcript object that was signed by halo-receipts */
  transcript: unknown;
}

export interface HaloVerifyResult {
  ok: boolean;
  errors?: string[];
}

// ── Error message ─────────────────────────────────────────────────────────────

const MISSING_PACKAGE_ERROR =
  "halo-receipts is not installed. " +
  "Install it for E2E with:\n" +
  "  npm install github:Swixixle/HALO-RECEIPTS#main\n" +
  "E2E tests require access to the halo-receipts dependency. " +
  "See README for details.";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isModuleNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" ||
      (err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND")
  );
}

function buildMessages(
  promptOrMessages: string | Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  return typeof promptOrMessages === "string"
    ? [{ role: "user", content: promptOrMessages }]
    : promptOrMessages;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Invoke an LLM via the real halo-receipts `invokeLLMWithHalo` function,
 * which handles provenance tracking and HALO receipt signing.
 *
 * The `__endpoint` field is used to route the request inside halo-receipts
 * and is stripped before the payload reaches the upstream provider.
 */
export async function invokeLLMWithHaloAdapter(
  args: InvokeLLMWithHaloArgs
): Promise<InvokeLLMWithHaloResult> {
  let invokeLLMWithHalo: (payload: Record<string, unknown>) => Promise<InvokeLLMWithHaloResult>;
  try {
    // Dynamic import so the package remains optional; throws at runtime if missing
    ({ invokeLLMWithHalo } = await import("halo-receipts/server/llm/invokeLLMWithHalo.js"));
    if (typeof invokeLLMWithHalo !== "function") {
      throw new Error("invokeLLMWithHalo export not found in halo-receipts");
    }
  } catch (err) {
    if (isModuleNotFound(err)) throw new Error(MISSING_PACKAGE_ERROR);
    throw err;
  }

  const { endpoint, model, promptOrMessages } = args;
  const messages = buildMessages(promptOrMessages);

  // Build the payload shape expected by the halo-receipts openai adapter.
  // __endpoint is stripped by halo-receipts before reaching the upstream provider.
  const payload: Record<string, unknown> =
    endpoint === "/chat/completions"
      ? { __endpoint: "/chat/completions", messages, model }
      : { __endpoint: "/responses", input: messages, model };

  return invokeLLMWithHalo(payload);
}

/**
 * Verify a HALO receipt using the real halo-receipts verification utilities.
 *
 * Returns { ok: true } when the receipt is valid, or
 * { ok: false, errors: [...] } describing what failed.
 */
export async function verifyHaloReceiptAdapter(
  transcript: unknown,
  haloReceipt: unknown
): Promise<HaloVerifyResult> {
  let verifyFn: (transcript: unknown, receipt: unknown) => Promise<HaloVerifyResult>;
  try {
    // Dynamic import so the package remains optional; throws at runtime if missing
    const m = await import("halo-receipts");
    const candidate = m.verifyForensicPack ?? m.verifyReceipt;
    if (candidate === undefined || candidate === null) {
      throw new Error(
        "halo-receipts does not export verifyForensicPack or verifyReceipt"
      );
    }
    if (typeof candidate !== "function") {
      throw new Error(
        `halo-receipts exports verifyForensicPack/verifyReceipt but it is not a function (got ${typeof candidate})`
      );
    }
    verifyFn = candidate;
  } catch (err) {
    if (isModuleNotFound(err)) throw new Error(MISSING_PACKAGE_ERROR);
    throw err;
  }

  return verifyFn(transcript, haloReceipt);
}
