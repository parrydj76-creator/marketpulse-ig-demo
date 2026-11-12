# MarketPulse AI v170 — certification gap report + real PostgreSQL concurrency rehearsal

## What it does
- `/api/v170/status`: reports all seven independently unverified certifications explicitly. No invented certification flags.
- `/api/v170/certifications`: evidence gaps for each certification.
- `/api/v170/fault-tests`: seven fail-closed local tests.
- `POST /api/v170/lease/concurrency`: eight simultaneous competing workers against the PostgreSQL lease, followed by takeover and stale-owner rejection. **Rehearsal only**. Do not run while another lease rehearsal is in progress.
- `POST /api/v170/arm`: always 409. No IG dealing functions are implemented or called by v170.

## Install
Based on v160. Back up GitHub first, review `server.js` diff, upload new `v170-certification.js`, updated `server.js`, and keep all existing files, PostgreSQL and environment variables. Set `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`, `V125_READONLY_POLL_MS=60000`.

## Test in Render Shell
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
for route in status certifications fault-tests; do
 curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v170/$route" | python3 -m json.tool
done
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v170/lease/concurrency" | python3 -m json.tool
```

## Important: what remains unverified
Seven independent certifications remain **0/7**. The new lease stress test does not demonstrate that an IG order path uses the lease or that a stale process cannot send a broker request. It does not validate broker pip values, commissions, FX rates, exchange-time timestamps, protective stops, unknown submission recovery, or actual broker P&L. An operator-approved controlled IG DEMO trade, plus independent contract documents, is needed for real lifecycle certification. Do not enable unattended trading until these are established.
