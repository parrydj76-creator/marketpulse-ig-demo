# MarketPulse AI v126–v140 Mega Upgrade (read-only certification workbench)

Built by extending the supplied v125 GitHub-ready ZIP. The source is a snapshot: compare your current GitHub changes before replacing files.

## What is actually implemented
- Existing v125 PostgreSQL rehearsal store and IG read-only polling preserved.
- New `/api/v140/status` and `/api/v140/report`: consolidated unresolved certification requirements and polling health.
- `/api/v140/risk/review` accepts operator-supplied, independently sourced contract/FX/quote parameters and calculates a **candidate** risk check. Does not derive IG contract size, FX or certifications.
- `/api/v140/pnl/review` checks operator-supplied daily balance/fees/cashflow reconciliation, UK date range and completeness flags. Does not automatically retrieve or certify actual IG charges.
- `/api/v140/database/audit` reads PostgreSQL rehearsal-intent counts, duplicate fingerprints, event-chain linkage and missing events. It does **not** cryptographically recompute event hashes and is **not** a production broker execution lock.
- `/api/v140/fault-tests` adds 14 local fail-closed tests. Existing 14 v125 tests remain.
- `/api/v140/arm` explicitly returns HTTP 409. No IG POST dealing requests or unattended order execution.

## IMPORTANT polling configuration fix
The existing v125 code only enables polling when `60000 <= V125_READONLY_POLL_MS <= 3600000`. Setting `30000` disables polling. Set `V125_READONLY_POLL_MS=60000` (60 seconds) or `120000` (2 minutes). With 60-second TTL, a 60-second poll still sometimes shows stale; monitor API limits and do not assume uninterrupted freshness. No polling code changes are made in this upgrade.

## Install
1. Back up GitHub and Render persistent data; do not overwrite existing journals or `.env`.
2. Extract ZIP; upload the runtime `.js` files, including `server.js` and `v140-mega.js`, to the same GitHub directory. Retain your existing `package.json`, `public/`, and unlisted files. Review differences from your live repo first.
3. Retain `V125_DATABASE_URL` and installed `pg` package. Set `V125_READONLY_POLL_MS=60000` or `120000` (not `30000`).
4. Keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`. Do not enable broker execution.
5. Deploy, then run the tests below in Render Shell.

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for route in status report fault-tests database/audit; do
  echo "==== $route ===="
  curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v140/$route" | python3 -m json.tool
done
```

To test fail-closed risk validation (no order):
```bash
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v140/risk/review" | python3 -m json.tool
```

## Still required before unattended IG DEMO
Actual broker contract/GBP-per-pip evidence, transaction and charges reconciliation, independently verified feed timestamps, operator-controlled real DEMO protective-stop lifecycle, unknown-order reconciliation, and a distributed lease with fencing integrated into the **actual** order submission path. This release does not certify or implement those dealing operations. All dealing remains hard-blocked.
