# Provider Configuration

This repo currently implements a production adapter for **OpenAI-compatible** endpoints.

## Current implementation status

- OpenAI-compatible provider path: implemented
  - Entry points: `src/cli/run.ts`, `src/adapters/haloReceiptsAdapter.ts`
- Anthropic provider adapter: **not implemented yet**
- Gemini provider adapter: **not implemented yet**

Codebase check:

- No `anthropic` provider adapter found under `src/`
- No `gemini` provider adapter found under `src/`

## Environment variables

From `.env.example`:

- `OPENAI_API_KEY` — required for live OpenAI demo and E2E
- `ANTHROPIC_API_KEY` — reserved for future Anthropic adapter
- `GEMINI_API_KEY` — reserved for future Gemini adapter
- `E2E_MODEL` — model used in live demo/E2E (OpenAI path)
- `E2E_ENDPOINT` — endpoint path (`/chat/completions` or `/responses`)
- `LLM_PROVIDER` — optional routing hint (currently informational)
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

## Anthropic (not implemented yet)

No Anthropic-specific adapter exists in `src/adapters/`.

### Current status

- `ANTHROPIC_API_KEY` can be set in env, but no Anthropic request path is wired in code.
- To implement, add a provider adapter under `src/adapters/` and route it from `src/cli/run.ts`.

### Placeholder commands (will fail until adapter is added)

```sh
ANTHROPIC_API_KEY=... npm run demo -- --prompt "..."
RUN_E2E=1 ANTHROPIC_API_KEY=... npm run test:e2e
```

## Gemini (not implemented yet)

No Gemini-specific adapter exists in `src/adapters/`.

### Current status

- `GEMINI_API_KEY` can be set in env, but no Gemini request path is wired in code.
- To implement, add a provider adapter under `src/adapters/` and route it from `src/cli/run.ts`.

### Placeholder commands (will fail until adapter is added)

```sh
GEMINI_API_KEY=... npm run demo -- --prompt "..."
RUN_E2E=1 GEMINI_API_KEY=... npm run test:e2e
```

## Common failure modes

- Missing key (`OPENAI_API_KEY`) → live demo/E2E fails immediately
- Wrong model name (`E2E_MODEL`) → provider 400/404 model-not-found
- Wrong endpoint (`E2E_ENDPOINT`) → provider 404/400
- Auth failures (401/403) → invalid key, org/project mismatch, or restricted model
- Rate limits (429) → retry later, lower request frequency, or switch model tier
