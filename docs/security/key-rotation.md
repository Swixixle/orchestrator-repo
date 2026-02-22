# Key Rotation Policy

## Rotation Interval
- Keys must be rotated every 90 days

## Dual Key Support Window
- System supports both old and new keys for 14 days during rotation

## Revocation Process
- Old keys are revoked after dual support window
- Receipts signed with old keys are no longer accepted

## Backward Compatibility
- Verification logic supports receipts signed with both old and new keys during dual support window
- After revocation, only new keys are valid
