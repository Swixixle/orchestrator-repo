# Provider Configuration

This repo currently implements production adapters for:

- OpenAI-compatible endpoints
- Anthropic Messages API (Claude)
- Gemini GenerateContent API

## Current implementation status

- OpenAI-compatible provider path: implemented
  - Entry points: `src/cli/run.ts`, `src/adapters/haloReceiptsAdapter.ts`
- Anthropic provider adapter: implemented
  - Entry points: `src/cli/run.ts`, `src/adapters/anthropicAdapter.ts`
- Gemini provider adapter: implemented
  - Entry points: `src/cli/run.ts`, `src/adapters/geminiAdapter.ts`

Codebase check:

- Anthropic adapter found: `src/adapters/anthropicAdapter.ts`
- Gemini adapter found: `src/adapters/geminiAdapter.ts`

## Environment variables

From `.env.example`:

- `OPENAI_API_KEY` — required for live OpenAI demo and E2E
- `ANTHROPIC_API_KEY` — required for Anthropic demo path
- `ANTHROPIC_BASE_URL` — optional API base URL override (default: `https://api.anthropic.com`)
- `ANTHROPIC_MAX_TOKENS` — default max tokens for Anthropic requests
- `ANTHROPIC_TEMPERATURE` — optional temperature for Anthropic requests
- `GEMINI_API_KEY` — required for Gemini demo path
- `GEMINI_BASE_URL` — optional API base URL override (default: `https://generativelanguage.googleapis.com`)
- `GEMINI_MAX_TOKENS` — default max tokens for Gemini requests
- `GEMINI_TEMPERATURE` — optional temperature for Gemini requests
- `E2E_MODEL` — model used in live demo/E2E (OpenAI path)
- `E2E_ENDPOINT` — endpoint path (`/chat/completions` or `/responses`)
- `LLM_PROVIDER` — default provider selection (`openai` or `anthropic`)
- `LLM_BASE_URL` — optional base URL override for OpenAI-compatible endpoints

## OpenAI (implemented)

### Demo

```sh
OPENAI_API_KEY=sk-... \
E2E_MODEL=gpt-4.1-mini \
E2E_ENDPOINT=/chat/completions \
npm run demo -- --prompt "Explain what causes ocean tides."
```

### E2E (opt-in)

```sh
RUN_E2E=1 \
OPENAI_API_KEY=sk-... \
E2E_MODEL=gpt-4.1-mini \
E2E_ENDPOINT=/chat/completions \
npm run test:e2e
```

## Anthropic (implemented)

### Demo

```sh
ANTHROPIC_API_KEY=... \
npm run demo -- --provider anthropic --model claude-3-5-sonnet-20241022 --prompt "Explain what causes ocean tides."
```

Input-file form:

```sh
ANTHROPIC_API_KEY=... \
npm run demo -- --provider anthropic --model claude-3-5-sonnet-20241022 --input-file prompts/example.txt
```

Verification:

```sh
npm run verify -- --artifact out/artifact.json
```

### E2E status

The existing `test:e2e` suite is OpenAI-oriented. Anthropic live E2E is not yet added as a separate suite.

## Gemini (not implemented yet)

### Demo

```sh
GEMINI_API_KEY=... \
npm run demo -- --provider gemini --model gemini-1.5-flash --prompt "Explain what causes ocean tides."
```

Input-file form:

```sh
GEMINI_API_KEY=... \
npm run demo -- --provider gemini --model gemini-1.5-flash --input-file prompts/example.txt
```

## Common failure modes

- Missing key (`OPENAI_API_KEY`) → live demo/E2E fails immediately
- Missing key (`ANTHROPIC_API_KEY`) → Anthropic demo fails immediately
- Missing key (`GEMINI_API_KEY`) → Gemini demo fails immediately
- Wrong model name (`E2E_MODEL`) → provider 400/404 model-not-found
- Wrong endpoint (`E2E_ENDPOINT`) → provider 404/400
- Auth failures (401/403) → invalid key, org/project mismatch, or restricted model
- Rate limits (429) → retry later, lower request frequency, or switch model tier
