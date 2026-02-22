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
    haloReceiptsContract.ts # Integration contract: single import point for halo-receipts
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
    adapters.test.ts             # Meta-test: most unit tests must not import adapters
    haloReceipts.contract.test.ts  # Smoke test: validates halo-receipts contract exports
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
| `RECEIPT_SIGNING_KEY` | ⚠️ Recommended | Ed25519 private key PEM for halo-receipts signing.        |
| `RECEIPT_VERIFY_KEY`  | ⚠️ Recommended | Ed25519 public key PEM for receipt verification. When set, `verifyHaloReceiptAdapter` checks the signature in addition to the transcript hash. |
| `RECEIPT_KEY_ID`    | ⚠️ If required | Key identifier for halo-receipts (if the package requires it). |
| `RUN_E2E`           | ✅ Yes   | Must be `1` to enable the E2E suite.                               |

> **Note:** E2E tests require the `halo-receipts` package to be installed and built.
> It is **not** a listed dependency and must be installed manually before running E2E:
>
> ```sh
> # 1. Install the package
> npm install --no-save github:Swixixle/HALO-RECEIPTS#f58fcace72640689ecc5d0110feafbb08a3424d9
>
> # 2. Build the package entry point (dist/index.js)
> cd node_modules/halo-receipts && npm install && node_modules/.bin/tsx -e "
>   import { build } from 'esbuild';
>   await build({ entryPoints: ['index.ts'], platform: 'node', bundle: true,
>     format: 'esm', outfile: 'dist/index.js', external: ['crypto'] });
> " && cd ../..
> ```

#### Optional environment variables (E2E)

| Variable       | Default              | Description                                              |
|----------------|----------------------|----------------------------------------------------------|
| `E2E_ENDPOINT` | `/chat/completions`  | API path. Use `/responses` for the Responses API.        |
| `E2E_MODEL`    | `gpt-4.1-mini`       | Model name passed to the API.                            |
| `HALO_RECEIPTS_CONTRACT_VERSION` | `1.0.0` | Expected halo-receipts contract version. Override to enforce compatibility with a specific pinned commit. |

#### What invariants the E2E asserts (no content assertions)

1. **Receipt shape** – `id`, `timestamp`, `requestHash`, `responseHash`, `signature` all present and correctly formatted.
2. **Provenance hash** – `provenance.provenance_hash` exists and is a non-empty string.
3. **Receipt verifies** – `verifyHaloReceiptAdapter` returns `{ ok: true }` (transcript hash check; signature check if `RECEIPT_VERIFY_KEY` is set).
4. **ELI ledger parses** – `ledger.claims.length > 0`.
5. **Every claim has `id`, `type`, and `span_refs`** – structural integrity.
6. **Semantic validation passes** – `validateLedgerSemantics` returns `ok: true` with no ERROR issues.
7. **At least one FACT or INFERENCE claim** – confirms tagger produced meaningful epistemic labels.
8. **No credentials in transcript** – `provenance` and `haloReceipt.response` do not contain `"Bearer "` or the API key.

---

## HALO-RECEIPTS contractVersion pinned

The integration between this orchestrator and the `halo-receipts` package is
governed by a strict contract defined in
`src/adapters/haloReceiptsContract.ts`.

| Item | Value |
|------|-------|
| **Pinned contract version** | `1.0.0` |
| **Override env var** | `HALO_RECEIPTS_CONTRACT_VERSION` |
| **Package pin** | `github:Swixixle/HALO-RECEIPTS#main` |

The contract:
- Imports `HALO_RECEIPTS_CONTRACT` from the package root entry point (no deep-path imports).
- Validates `contractVersion` is a non-empty string and matches the pinned version.
- Validates every required export is a function: `invokeLLMWithHalo`, `haloSignTranscript`, `verifyTranscriptReceipt`.
- Throws a single actionable error listing which exports were found vs. missing.
- Wraps `invokeLLMWithHalo` to capture the signed transcript (needed for
  verification).
- Implements `verifyTranscriptReceipt` using HALO-RECEIPTS canonicalisation
  primitives — always checks the hash, optionally checks the Ed25519 signature
  when `RECEIPT_VERIFY_KEY` is set.

A non-network **smoke test** (`tests/unit/haloReceipts.contract.test.ts`) loads
the contract on every `npm test` run and detects export-surface drift without
requiring `OPENAI_API_KEY`.

---

## CI

The GitHub Actions workflow (`ci.yml`) runs **unit tests only** on every push and pull request. No API keys are required or used.

A separate **manual** workflow (`e2e.yml`) is available for running the E2E suite on-demand via `workflow_dispatch`. It is never triggered automatically.
