# halo-orchestrator

Cross-system integration harness for the HALO receipt pipeline.

This repo is the **orchestrator** layer that wires:

```
invokeLLM → HALO sign → ELI tag → semantic validate
```

It is intentionally separate from HALO-RECEIPTS to keep the forensic core
deterministic and free of live-network calls, costs, and model nondeterminism.

---

## Why a separate repo?

**HALO-RECEIPTS** stays as a "forensic core":
- ✅ deterministic unit + golden + offline verification tests
- ✅ mocked upstream responses for Gate 0 hashing/signing tests
- ❌ no live LLM calls

**This repo** handles cross-system integration:
- ✅ the single E2E test that hits a real model
- ✅ wires HALO receipt generation + ELI tagging + semantic validation
- ✅ becomes the seed of the proxy product harness
- ✅ runs locally on-demand; in CI only when explicitly enabled

---

## Project structure

```
src/
  halo/
    signer.ts      # HALO receipt signer (HMAC-SHA256 over response hash)
    verifier.ts    # Offline verifier (tamper detection)
  eli/
    tagger.ts      # ELI claim tagger (epistemic type + span refs)
    validator.ts   # Semantic discipline validator
  adapters/
    haloReceiptsAdapter.ts  # E2E adapter: invokeLLMWithHaloAdapter + verifyHaloReceiptAdapter
    eliAdapter.ts           # E2E adapter: tagResponseToLedger + validateLedgerSemantics
  mocks/
    haloMock.ts    # Re-exports toy signer/verifier for unit tests only
    eliMock.ts     # Re-exports toy tagger/validator for unit tests only
  orchestrator.ts  # Pipeline entry point (used by unit tests)

tests/
  unit/            # Deterministic unit tests – always run in CI
    halo.test.ts
    eli.test.ts
    orchestrator.test.ts
    adapters.test.ts  # Meta-test: adapters must not be imported in unit suite
  e2e/             # Live E2E test – opt-in only (RUN_E2E=1)
    chain.e2e.test.ts
```

---

## Running tests

### Unit tests (always safe, no network, no keys)

```sh
npm test
```

Unit tests are fully deterministic: no API keys, no network calls, no
external dependencies. They run in CI on every push and pull request.

### E2E test (opt-in – requires a real LLM provider key)

```sh
cp .env.example .env
# Edit .env: set OPENAI_API_KEY and RUN_E2E=1

RUN_E2E=1 OPENAI_API_KEY=sk-... npm run test:e2e
```

#### Required environment variables (E2E only)

| Variable            | Required | Description                                                        |
|---------------------|----------|--------------------------------------------------------------------|
| `OPENAI_API_KEY`    | ✅ Yes   | OpenAI (or compatible) API credential. Never stored in receipts.  |
| `RECEIPT_SIGNING_KEY` | ⚠️ Recommended | HMAC signing key. Falls back to `HALO_SIGNING_KEY`, then a built-in test key. |
| `RUN_E2E`           | ✅ Yes   | Must be `1` to enable the E2E suite.                               |

#### Optional environment variables (E2E)

| Variable       | Default              | Description                                              |
|----------------|----------------------|----------------------------------------------------------|
| `E2E_ENDPOINT` | `/chat/completions`  | API path. Use `/responses` for the Responses API.        |
| `E2E_MODEL`    | `gpt-4.1-mini`       | Model name passed to the API.                            |

#### What invariants the E2E asserts (no content assertions)

1. **Receipt shape** – `id`, `timestamp`, `requestHash`, `responseHash`, `signature` all present and correctly formatted.
2. **Receipt verifies** – `verifyHaloReceiptAdapter` returns `{ ok: true }` (signature + hash check).
3. **ELI ledger parses** – `ledger.claims.length > 0`.
4. **Every claim has `id`, `type`, and `span_refs`** – structural integrity.
5. **Semantic validation passes** – `validateLedgerSemantics` returns `ok: true` with no ERROR issues.
6. **At least one FACT or INFERENCE claim** – confirms tagger produced meaningful epistemic labels.
7. **No credentials in transcript** – `provenance` and `haloReceipt.response` do not contain `"Bearer "` or the API key.

---

## CI

The GitHub Actions workflow (`ci.yml`) runs **unit tests only** on every push and pull request. No API keys are required or used.

A separate **manual** workflow (`e2e.yml`) is available for running the E2E suite on-demand via `workflow_dispatch`. It is never triggered automatically.
