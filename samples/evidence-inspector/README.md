# Evidence Inspector Samples

These files are designed for manual acceptance checks in the HALO Evidence Inspector.

## Files

- master_receipt.valid.json
- evidence_pack.valid.json
- evidence_pack.tampered_transcript.json
- master_receipt.tampered_content_hash.json
- artifact.valid.json
- artifact.with_leak.json

## Suggested checks

1. Load only master_receipt.valid.json -> Unverified (no evidence pack loaded).
2. Load master_receipt.valid.json + evidence_pack.valid.json -> Verified.
3. Load master_receipt.valid.json + evidence_pack.tampered_transcript.json -> Unverified (hash mismatch).
4. Load master_receipt.tampered_content_hash.json + evidence_pack.valid.json -> Unverified (hash mismatch).
5. Load artifact.with_leak.json -> leak warning visible and Share/Export disabled.
