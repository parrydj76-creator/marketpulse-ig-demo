# MarketPulse AI v35 — integrated journal fix and paper diagnostics

This archive is a complete project snapshot based on the v34 integrated project.

## Changes
- Retains the v33 instance and connects its current journal status to v34.
- Removes hardcoded `unresolvedIntents:1`.
- Rejects paper candidates when the v33 count is missing, invalid, negative, or its storage is unhealthy.
- Adds authenticated read-only `GET /api/v35/status` and dashboard `/v35`.
- Keeps v34 automatic paper evaluations, existing v34 paper journal and all prior routes.
- Adds tests for zero, positive, and unknown unresolved-intent states.

## Install
Back up your GitHub repository and Render persistent disk first. Upload the contents of `marketpulse-ig-demo-main/` into the existing repo, preserving your environment variables and persistent disk. Commit and deploy. Do not upload your `.env` or private credentials.

## Verify (Render Shell)
```sh
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v35/status"
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v34/paper/cycle"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v34/status"
```
`ORDER_INTENT_STATUS_UNVERIFIED` is a deliberate rejection when journal state cannot be established. `LOCAL_JOURNAL_CLEAR` does not establish that IG has no in-flight requests.

## Safety
V35 and v34 never submit broker orders. **Legacy routes must be independently audited:** v34/v35 status flags do not establish that older routes cannot execute. Set `BROKER_DEMO_EXECUTION=false` and leave any other broker-execution enable flags off. No GBP sizing, order lifecycle or crash recovery certification is claimed. Paper evaluations are not simulated fills or realised P&L. v34 automation is disarmed after a restart; start it manually when ready.
