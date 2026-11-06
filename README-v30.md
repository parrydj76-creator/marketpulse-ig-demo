# MarketPulse AI v30 — IG DEMO historical evidence (read-only)

This is a **complete integrated repository** based on v29. v30 adds historical evidence lookup, local persisted observation records, and a mobile-friendly dashboard. **It does not submit or enable IG broker orders**. Existing broker hard blocks must remain in place. Live accounts must not be used.

## Deploy

Back up your GitHub repository; extract this ZIP into the repository root (the inner `marketpulse-ig-demo-main` folder contains the application). Do not upload `.env` or secrets. Redeploy on Render; open `/v30`. Admin token stays in browser memory only for the current page session. Run `npm test` and `node --check server.js`.

## Verify completed trade

Open `/v30`, enter your admin token, enter the IG **position Deal ID** (e.g. `S7PAP8BB`) and click *Inspect IG demo history*. Alternatively:

```sh
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"dealId":"S7PAP8BB"}' "http://127.0.0.1:${PORT:-10000}/api/v30/history/verify"
```

This reads IG `/history/transactions` (v2) and `/positions` (v2). The lookup searches the first 100 transactions from the past 30 days. Some IG account types or API versions may return different transaction schemas or reject date formatting; if so the endpoint returns an error, not a false success. It **does not** claim that a transaction reference is an API `dealReference`. Historical data may not include protective stops or both confirmation references. Records contain observation digests and limited metadata, not credentials. `GET /api/v30/records` shows saved observations.

## Persistence limitation

Records are written to `DATA_DIR/v30-history.json` via atomic rename. On Render without a persistent disk, **they can disappear across deploy/restart**. `persistentStorageConfigured` reflects the application's `PERSISTENT_STORAGE` setting, not an independent proof of storage durability. Do not enable automated broker execution on the strength of these records.

## Automation gates

**Unattended demo broker orders are NOT enabled.** Before any future controlled broker write, independently validate the demo account and instrument units, GBP-per-pip/contract and quantity increment, stop distance and total risk, broker confirmations and rejection handling, order idempotency, restart-safe journal, in-flight recovery, position reconciliation, and kill switch. Use operator approval for each controlled demo test. Live-money orders remain out of scope.
