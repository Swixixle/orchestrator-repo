# Contract Upgrade Protocol

This document outlines the required steps for safely upgrading the `halo-receipts` contract and maintaining deterministic integrity across the orchestrator system.

---

## 1. Bump `halo-receipts` Version

- Update the semantic version in `src/types/halo-receipts.d.ts` and all relevant contract references.
- Follow [Semantic Versioning](https://semver.org/) strictly:
  - **MAJOR**: Breaking changes to receipt structure or verification logic
  - **MINOR**: Backward-compatible additions (fields, optional logic)
  - **PATCH**: Bugfixes, clarifications, or non-breaking changes

## 2. Regenerate Golden Receipts

- For each supported provider (OpenAI, Anthropic, Gemini):
  - Use the deterministic prompt: `"Return the word HALO exactly."`
  - Generate a new receipt using the current contract logic.
  - Save as `test/golden-receipts/{provider}.receipt.json`.

## 3. CI Guard Requirement

- The test suite must include a golden receipt test:
  - Re-generates each golden receipt
  - Deep-compares against the fixture
  - Fails CI if any structural drift is detected

## 4. Golden Receipt Update Procedure

1. Bump contract version as above
2. Regenerate all golden receipts
3. Run the full test suite
4. Commit updated fixtures and contract
5. Open a PR for review

## 5. Golden Receipt Review Checklist

- [ ] All golden receipts updated
- [ ] No structural drift in unrelated fields
- [ ] CI guard test passes
- [ ] Version bump is semver-appropriate

---

## 6. Additional Notes

- Golden receipts are the canonical reference for contract integrity.
- Any PR that changes the contract or golden receipts must be reviewed by at least one maintainer.
- Never merge a contract change without passing the golden receipt CI guard.
