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

## Quick Start (Recommended)

```sh
./scripts/setup.sh
```

This installs dependencies, installs/builds pinned `halo-receipts`, runs deterministic tests, runs UI smoke, and validates sample verification.

Runbooks:

- `docs/onboarding.md` (Zero → Verified in ~30 minutes)
- `docs/providers.md` (OpenAI / Anthropic / Gemini status and commands)
- `docs/evidence-inspector-production.md` (production hosting)

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
  cli/
    run.ts         # `npm run demo` – invoke pipeline, write out/ artifacts
    verify.ts      # `npm run verify` – offline verify a saved artifact
  mocks/
    haloMock.ts    # Re-exports toy signer/verifier for unit tests only
    eliMock.ts     # Re-exports toy tagger/validator for unit tests only
  types/
    artifact.ts    # Stable Artifact schema (truth object written by CLI)
  utils/
    leakScan.ts    # Credential leak scanner (used by CLI + E2E test)
  orchestrator.ts  # Pipeline entry point (used by unit tests)

tests/
  unit/            # Deterministic unit tests – always run in CI
    halo.test.ts
    eli.test.ts
    orchestrator.test.ts
    cli.test.ts                  # leakScan + artifact shape + CLI arg parsing
    adapters.test.ts             # Meta-test: most unit tests must not import adapters
    haloReceipts.contract.test.ts  # Smoke test: validates halo-receipts contract exports
  e2e/             # Live E2E test – opt-in only (RUN_E2E=1)
    chain.e2e.test.ts

out/               # gitignored – all CLI and E2E output files go here
```

---

## One-line integration

```typescript
import { runPipeline } from "halo-orchestrator";

const result = await runPipeline(prompt, myLLMInvoker);
// result.receipt   – HALO tamper-evident receipt
// result.ledger    – ELI epistemic claim ledger
// result.validation – semantic discipline validation
```

---

## Demo

Run the full pipeline against a live LLM and write all artifact files to `out/`:

```sh
OPENAI_API_KEY=sk-... npm run demo -- --prompt "Explain what causes ocean tides."
```

Output files written to `out/` (gitignored):

| File | Contents |
|------|----------|
| `artifact.json` | Full machine-readable truth object |
| `receipt.json` | HALO receipt only |
| `transcript.json` | Signed transcript object only |
| `ledger.json` | ELI ledger only |
| `report.md` | Human-readable summary |

Optional flags:

```sh
npm run demo -- --prompt "..." --model gpt-4o --endpoint /chat/completions --out-dir out
npm run demo -- --input-file path/to/prompt.txt
```

---

## Verification

Verify a previously generated artifact offline (no network required after halo-receipts is installed):

```sh
npm run verify -- --artifact out/artifact.json
```

Checks performed:
1. HALO receipt verification (transcript hash via halo-receipts)
2. ELI semantic validation re-run on stored ledger
3. Credential leak scan on transcript + receipt + provenance

Writes `out/verify_report.md`. Exits 0 on PASS, 1 on FAIL.

---

## Valet Bridge (`ingest-valet`)

Convert a Valet `dist/<slug>/` bundle into canonical HALO checkpoint artifacts:

```sh
VALET_RECEIPT_HMAC_KEY=... \
RECEIPT_SIGNING_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" \
npm run ingest-valet -- dist/<slug>/
```

Writes to `dist/<slug>/halo_checkpoint/`:

- `master_receipt.json` (hash-only, Ed25519-signed)
- `evidence_pack.json` (sensitive transcript + ELI assertions)
- `protocol_report.json` (PASS/FAIL checks + matched HMAC strategy)
- `ledger_submission.json` (only when `HALO_LEDGER_URL` is configured)

Optional ledger submission flags:

- `HALO_LEDGER_URL`
- `HALO_INGEST_ENDPOINT` (default: `/api/receipts/ingest`)
- `HALO_API_TOKEN` (optional bearer token)

---

## Evidence-Led UI (HALO Evidence Inspector)

Run a provenance-first local inspector for:

- `master_receipt.json`
- `evidence_pack.json`
- `artifact.json` (combined)

```sh
npm run ui:dev
```

Then open the local Vite URL (typically `http://localhost:5173`).

Production build + serve:

```sh
npm run ui:build
npm run ui:build:server
npm run ui:serve
```

One-command production run:

```sh
npm run ui:prod
```

Subpath deployment example:

```sh
UI_BASE_PATH=/evidence/ npm run ui:build
npm run ui:build:server
UI_BASE_PATH=/evidence/ UI_PORT=8080 npm run ui:serve
```

See full production guide: `docs/evidence-inspector-production.md`.

To regenerate manual acceptance fixtures:

```sh
npm run samples:generate
```

The inspector renders, in order:

1. Verified/Unverified status badge (**DERIVED**)
2. Signed master receipt summary (**SIGNED**, hash-only)
3. Derived verification panel (artifact verification + recomputed local verification)
4. Evidence pack transcript + ELI assertions (**UNSIGNED**, transcript marked **Sensitive**)
5. Unsigned commentary panel (**UNSIGNED**)
6. Leak scan findings (uses `src/utils/leakScan.ts`); Share/Export is disabled when leaks are detected

Verification policy:

- Never trusts `artifact.verification` alone
- Recomputes transcript hash when evidence pack transcript is loaded
- Attempts signature verification when a public key is available
- Shows `Unverified` when recomputation/signature checks cannot be completed

---

## Truth Claims

### What we can prove

| Claim | How |
|-------|-----|
| Exact request payload | Captured in `artifact.json → llm.requestParams` |
| Model identifier provided by API | Stored in `artifact.json → llm.model` |
| Request parameters (temperature etc.) | Stored in `artifact.json → llm.requestParams` |
| Full LLM response | Covered by HALO transcript hash |
| Receipt/transcript integrity | `verifyHaloReceiptAdapter` verifies hash (+ Ed25519 signature when key is configured) |
| Provenance hash | `artifact.json → provenance.provenanceHash` (if returned by provider) |

### What we cannot prove

| Claim | Why |
|-------|-----|
| Underlying model weights | We have no access to provider internals |
| Internal provider routing | Provider may serve any backend for a given model name |

---

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
> Use `./scripts/setup.sh` to automate installation/build of pinned `halo-receipts` and all smoke checks.

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
