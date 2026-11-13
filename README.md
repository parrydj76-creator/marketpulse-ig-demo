# MarketPulse AI v116–v125 Combined Infrastructure Upgrade

**Read-only fail-closed. No IG dealing calls added.** Built from the verified v115 source bundle. Existing v85–v115 runtime modules are retained.

## Release features
- v116: Optional read-only IG capture polling (`V125_READONLY_POLL_MS`; default 0/off, minimum 60000 ms).
- v117: Snapshot freshness and account/position/history consistency checks.
- v118: Fail-closed certification checklist; no inferred contract pip values or currency conversion.
- v119: Risk and daily-loss gates remain blocked pending actual IG evidence.
- v120: Optional PostgreSQL-backed rehearsal intent table, separate from all existing journals.
- v121: Transaction-scoped PostgreSQL advisory lock for rehearsal state updates.
- v122: Unique intent fingerprint to prevent duplicate rehearsal records.
- v123: Persistent state transitions and hash-linked rehearsal events.
- v124: Unknown-submission rehearsal state with no automatic retry and explicit reconciliation outcomes.
- v125: Admin-only status, diagnostics, tests, manual refresh and rehearsal workbench.

**Limitations:** The PostgreSQL lock only protects the rehearsal database transaction; it does NOT protect legacy broker order submission or certify distributed execution. Hash-linked events are not an independent tamper-proof audit. Polling does not certify undelayed prices, and a fresh snapshot does not certify a fresh streaming quote. There is no broker order lifecycle verification. The daily loss and risk limits remain uncertified.

## Installation
1. Back up your repository and Render persistent disk. Do not delete or modify any existing `.jsonl` files.
2. Extract ZIP and upload **all runtime `.js` files** into the same directory as your current `server.js`. Replace matching files; retain other existing files (e.g. `package.json`, `public/`, `.env`).
3. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false` (both hard-coded in `server.js`).
4. Commit and deploy. No database is required for read-only diagnostics and manual refresh.
5. **Optional**: For PostgreSQL rehearsal intents only, run `npm install pg --save` in your project, provision PostgreSQL, and set `V125_DATABASE_URL` on Render. Database tables are created on startup. Set `V125_PG_SSL=true` only if provider requires TLS and its certificate validates.
6. **Optional**: Set `V125_READONLY_POLL_MS=120000` to poll IG every two minutes. Default 0 disables automatic polling. Check IG rate limits, provider terms and Render service uptime before enabling. Each refresh makes multiple broker GET requests. In multi-instance deployments polling may occur on every instance; use one poller only.

## Render Shell tests
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for p in status diagnostics fault-tests rehearsal/summary; do
  echo "==== $p ===="
  curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v125/$p" | python3 -m json.tool
done
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v125/refresh" | python3 -m json.tool
```
Optional PostgreSQL rehearsal create (NOT an IG order):
```bash
# Generate fresh fingerprint and use a genuine evidence hash from a prior capture.
# POST /api/v125/rehearsal/create with {"fingerprint":"<64 hex>","evidenceHash":"<64 hex>","note":"dry-run"}
# POST /api/v125/rehearsal/transition with {"id":"<UUID>","state":"UNKNOWN","note":"simulated uncertain outcome"}
# Then transition to RECONCILED_NO_ORDER or RECONCILED_ORDER_EXISTS after operator review.
```

## Critical safety
- This release does not enable unattended demo or live orders.
- Remaining certification gaps: undelayed market feed, GBP contract pip value and sizing, verified net broker P&L including fees, actual protective-stop lifecycle, unknown-submit/restart broker recovery, and a single-writer lock integrated into any future execution path.
- Keep the paper simulator paused. Never set execution or auto-start to true.


## v193 release
See [README-v193.md](README-v193.md) for new read-only broker-readiness APIs and tests.
