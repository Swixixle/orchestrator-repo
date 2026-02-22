# Zero → Verified Receipt in 30 Minutes

This runbook gets a new operator from clone to verified artifacts quickly.

## A) What you get

- Verified HALO receipt evidence (`master_receipt` / `haloReceipt` depending on flow)
- Evidence pack (sensitive transcript + assertions)
- Offline verification report
- Evidence Inspector UI for provenance review

Related docs:

- Provider setup: `docs/providers.md`
- Production UI deploy: `docs/evidence-inspector-production.md`

## B) Fast path (offline, no secrets)

1. Run setup:

```sh
./scripts/setup.sh
```

2. Verify sample artifact:

```sh
npm run verify -- --artifact samples/evidence-inspector/artifact.valid.json
```

3. Start production UI:

```sh
npm run ui:prod
```

4. Open the printed URL, then load:

- `samples/evidence-inspector/master_receipt.valid.json`
- `samples/evidence-inspector/evidence_pack.valid.json`

## C) Live path (with OpenAI key)

1. Export key:

```sh
export OPENAI_API_KEY=sk-...
```

2. Run live demo:

```sh
npm run demo -- --prompt "Explain what causes ocean tides."
```

3. Generated outputs are in `out/`:

- `out/artifact.json`
- `out/receipt.json`
- `out/transcript.json`
- `out/ledger.json`
- `out/report.md`

4. Verify the demo artifact:

```sh
npm run verify -- --artifact out/artifact.json
```

5. In the UI, upload `out/artifact.json`.

## D) Valet integration path (bridge)

1. Ensure Valet bundle exists at `dist/<slug>/` with `receipt.json`.

2. Run bridge ingest:

```sh
VALET_RECEIPT_HMAC_KEY=... \
RECEIPT_SIGNING_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" \
npm run ingest-valet -- dist/<slug>/
```

3. Outputs are written to `dist/<slug>/halo_checkpoint/`:

- `master_receipt.json`
- `evidence_pack.json`
- `protocol_report.json`
- `ledger_submission.json` (if posting enabled)

4. Verify checkpoint artifacts by reviewing `protocol_report.json` and loading receipt/evidence in UI.

## E) Optional ledger push

If ledger ingestion is configured:

```sh
HALO_LEDGER_URL=https://ledger.example.com \
HALO_INGEST_ENDPOINT=/api/receipts/ingest \
HALO_API_TOKEN=... \
VALET_RECEIPT_HMAC_KEY=... \
RECEIPT_SIGNING_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" \
npm run ingest-valet -- dist/<slug>/
```

Submission response is saved to:

- `dist/<slug>/halo_checkpoint/ledger_submission.json`

## F) Troubleshooting

- `halo-receipts` missing or unbuilt:
  - rerun `./scripts/setup.sh`
- Offline verify signature fails:
  - check `RECEIPT_VERIFY_KEY` against signing key used for receipt generation
- UI subpath issues:
  - rebuild with `UI_BASE_PATH=/evidence/ npm run ui:build`
  - serve with `UI_BASE_PATH=/evidence/ npm run ui:serve`
- Leak scan warnings:
  - treat as policy blockers for sharing artifacts; remove secrets and rerun
