## Summary

- What changed?
- Why was it needed?

## Evidence-Led UI Acceptance Checks

- [ ] 1) Load `master_receipt.json` alone → badge shows **Unverified** (no evidence pack loaded)
- [ ] 2) Load `master_receipt.json` + `evidence_pack.json` → badge shows **Verified** when hash/signature checks pass
- [ ] 3) Load tampered evidence transcript → badge shows **Unverified**
- [ ] 4) Load tampered master `content_hash` → badge shows **Unverified**
- [ ] 5) Leak pattern detected (`Bearer`, key-like strings) → warning shown and **Share/Export** disabled

## Provenance Labeling

- [ ] Signed receipt fields are labeled **SIGNED**
- [ ] Runtime verification results are labeled **DERIVED**
- [ ] Commentary/transcript sections are labeled **UNSIGNED** (and transcript marked **Sensitive**)

## Test & Validation

- [ ] `npm test`
- [ ] `npm run ui:build`
- [ ] `npm run samples:generate` (if sample fixtures were touched)

## Notes

- Additional reviewer notes or known limitations.
