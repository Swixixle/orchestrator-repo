# Threat Model

## Key Exfiltration
- Keys are stored in environment variables only
- Rotate keys regularly (see key-rotation policy)
- Never log or persist keys

## Adapter Schema Drift
- Contract tests and CI guard prevent schema drift
- Golden receipt fixtures ensure structural integrity

## Replay Attacks
- Receipts include unique IDs and timestamps
- Verification checks for duplicate receipt IDs

## Receipt Tampering
- HMAC and Ed25519 signatures protect against tampering
- Verification fails if signatures or hashes are invalid

## Provider Impersonation
- API keys are provider-specific
- Verification checks provider field and signature

## DoS Risk
- Rate limiting middleware on critical endpoints
- Health checks and monitoring

## Credential Leakage
- Structured logging redacts secrets
- Leak scan checks for sensitive patterns in receipts and evidence
