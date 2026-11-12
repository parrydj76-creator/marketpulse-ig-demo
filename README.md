# MarketPulse AI v92–v95 Combined Mega Upgrade

Built on the v91 deployment source. All broker dealing remains **hard-blocked**.

## Included versions
- **v92**: Bounded read-only IG DEMO transaction history requests (API v2) using an explicit date range and up to ten pages of 100 entries. Endpoint compatibility is checked at runtime; unsupported history requests are recorded as errors, never certified.
- **v93**: Conservative contract-risk observations. Reports observed minimum deal size, stop distance and currency, but does **not** invent a GBP pip value, contract multiplier or trade size.
- **v94**: Read-only positions/accounts reconciliation diagnostics. Unexpected open positions are flagged. Broker identifiers and raw account/transaction rows are not stored in the evidence ledger.
- **v95**: Hash-linked evidence journal, restart integrity checks, safety readiness endpoint and blocked arm route.

## Install (GitHub / Render)
1. Back up the deployed GitHub files and persistent `DATA_DIR`, including the 205-record paper journal.
2. Extract this ZIP and upload the included runtime `.js` files to the **existing project root**, overwriting same-named files. Do not delete other project files or persistent journals.
3. Keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false` and v85 paper pause active. No new environment variables or credentials are needed.
4. Deploy on Render. Check `GET /api/v95/status`, `POST /api/v95/capture`, `GET /api/v95/recovery` with the existing `X-Admin-Token` header.

## Render commands
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v95/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"from":"2026-11-11","to":"2026-11-11"}' "$BASE/api/v95/capture" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v95/recovery" | python3 -m json.tool
```

## Limits and safety
- IG history API paths and response formats can vary by API/account; if unsupported, `checks.history.ok` is false and the error is reported. A failed history fetch is not a broker outage diagnosis.
- Date ranges are limited to 7 days, and pagination to 10 pages / 1,000 records. A full final page is flagged as possibly truncated. No complete daily net P&L or fee certification is inferred even from a successful request.
- Historical P&L and 3 quarantined paper trades remain unchanged. No journal rewriting, paper resumption or broker dealing routes are introduced.
- Broker protective stops, exchange delay, GBP pip value, FX conversion, fee reconciliation, unknown-submit recovery and distributed single-writer certification remain open blockers.
- The existing app has older legacy timers and endpoints; this package does not certify them. `brokerOrderAllowed:false` applies to these new verification modules and the v61 hard-block in supplied `server.js`.
- The capture endpoint is admin-protected and read-only against IG, but **writes diagnostic evidence locally**. Do not capture repeatedly without need.
- Run `node test-v95.js` and the included v85-v91 tests. Mocked tests do not substitute for live IG verification.
