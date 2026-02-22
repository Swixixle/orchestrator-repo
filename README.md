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
  orchestrator.ts  # Pipeline entry point

tests/
  unit/            # Deterministic unit tests – always run in CI
    halo.test.ts
    eli.test.ts
    orchestrator.test.ts
  e2e/             # Live E2E test – opt-in only (RUN_E2E=1)
    chain.e2e.test.ts
```

---

## Running tests

### Unit tests (always safe, no network, no keys)

```sh
npm test
```

### E2E test (opt-in – requires a real LLM provider key)

```sh
cp .env.example .env
# Edit .env: set OPENAI_API_KEY and RUN_E2E=1

RUN_E2E=1 OPENAI_API_KEY=sk-... npm run test:e2e
```

The E2E test asserts **invariants only** – not model content:
1. Receipt exists
2. Receipt verifies (signature + hashes)
3. ELI ledger parses (non-empty claims)
4. Semantic validation passes (no violations)
5. At least one claim has a valid `id / type / span_refs`

---

## CI

The GitHub Actions workflow (`ci.yml`) runs **unit tests only**.
The E2E test is never triggered in default CI.
