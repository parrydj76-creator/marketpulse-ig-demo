# MarketPulse AI v195 — Integrity Recovery and Execution Safety Gate

## Scope
This is a major **read-only safety upgrade**, NOT unattended IG DEMO execution. Broker submission remains hard-blocked. Seven certifications remain 0/7. It includes the v194 canonical JSON digest hotfix, with a strict legacy reconstruction check for historical v194 rows (no automatic rewriting or bypass).

## Changes
- v194: canonical, recursively key-sorted JSON hashing for new broker-read and event records; narrowly scoped legacy v194 verification for old records.
- v195: independent seven-certification readiness gate, immutable SHA-256 protected assessments, PostgreSQL JSONB write/read digest check, paginated gate audit with explicit incomplete-scope flag, blocking on any unresolved v194 intent or failed hash.
- All endpoints require the existing admin-token middleware.
- No IG POST, PUT or DELETE is passed into the v194/v195 modules.
- Existing v194 intent records and hashes are never overwritten.

## Install
Back up the current GitHub repository and PostgreSQL database. Upload this ZIP's contents to the repository root, preserving existing Render environment variables and secrets. Redeploy. DO NOT enable `BROKER_DEMO_EXECUTION` or `AUTO_START`.

## Render Shell verification
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v194/audit" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v194/broker/read" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v194/audit" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v195/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v195/gate/capture" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v195/gate/audit" | python3 -m json.tool
```
Expected: `v194/audit.verified=true`, `failures=[]`, old records counted as `legacyVerified`; new records as `canonicalVerified`. `v195/gate/capture.roundTripVerified=true`, `v195/gate/audit.verified=true`, `complete=true`. If any verification fails, stop; do not delete evidence. If the old records fail under the legacy algorithm, investigate the precise schema rather than treating them as valid.

## Limitations and next milestone
- No independent broker contract/pip sizing certification, exchange timestamp proof, daily accounting reconciliation, broker-backed stop lifecycle, unknown-submission recovery or broker-path fencing.
- Database tests included in `test-v195.js` use a mock pool. Real PostgreSQL round-trip and live IG tests must be completed on Render.
- Historical v194 audit is limited to the latest 500 broker reads/events, and v195's own audit caps at 20,000 records. Neither implies all-history verification.
- This release does not establish exactly-once IG execution or enable unattended demo trading.
