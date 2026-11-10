# MarketPulse AI v61 — unattended-readiness hardening (read-only)

This release adds v61 readiness auditing, durable crash-recovery rehearsals, explicit resolution, duplicate-intent protection, and a compact dashboard. It preserves v58-v60 histories. The v61 server globally sets `BROKER_DEMO_EXECUTION=false` so older broker routes cannot be enabled by environment flags. No v61 IG dealing adapter exists.

## Deployment
Back up GitHub and Render persistent disk. Replace repository-root files with the ZIP contents. Keep the existing persistent disk mount and admin token. Do not turn on broker execution flags. Verify `npm test` and `node --check server.js` before deploying.

## Render Shell verification
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v61/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v61/audit" | python3 -m json.tool
```

A clean audit means **eligible for read-only rehearsal only**, not broker execution certification. The four certifications remain false. Real IG DEMO dealing needs a separate, verified broker-specific adapter, authenticated account checks, proven GBP pip sizing, explicit supervised open/close tests, timeout reconciliation, and a full failure-injection suite.

## Rehearsal (no broker write)
POST `/api/v61/prepare-rehearsal` with JSON `{ "intentId":"demo-test-001", "epic":"CS.D.EURUSD.MINI.IP", "direction":"BUY", "size":0.1, "stopPips":12 }`; POST `/api/v61/recover` after a restart; POST `/api/v61/resolve-rehearsal` with `{ "intentId":"demo-test-001", "confirmation":"CONFIRM_REHEARSAL_ONLY" }`. Rehearsals never submit IG orders. No automatic retry exists.
