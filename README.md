# MarketPulse AI v73 — broker evidence and recovery workbench

**Read-only IG integration. No broker order submission, no automatic dealing, no supervised live order submission.** This is a development milestone, not an execution certification.

## Installation

Back up your existing repository and persistent journal directory. Upload `server.js` and `v73-recovery.js` to the root of your existing GitHub repository. Retain all earlier v67–v72 modules, `public/`, package files and Render environment configuration. Keep all legacy execution switches disabled. Redeploy on Render.

## Features

- Read-only audit of IG account currency, position count, EUR/USD Mini metadata and transaction endpoint availability.
- Captures instrument contract/dealing-rule fields for independent review. These fields **do not establish GBP pip value or permissible trade size** by themselves.
- Append-only, fsync-backed, hash-linked v73 evidence journal, startup integrity verification and fail-closed behaviour on journal errors.
- Durable **simulated** order-intent ledger with UUID identifiers, restart reconstruction, duplicate-intent prevention and explicit simulated resolution.
- Scheduled read-only audit every 60 seconds.
- Hard-blocked unattended arming route and no broker-write callbacks.

## Test on Render Shell

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v73/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v73/audit" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v73/recovery" | python3 -m json.tool
```

Optional **local dry-run only**, with zero IG order submission:

```bash
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"direction":"BUY","confirm":"DRY_RUN_NO_BROKER_ORDER"}' "$BASE/api/v73/dry-run-intent" | python3 -m json.tool
```

The dry-run creates an unresolved simulated intent, which must be resolved explicitly with `POST /api/v73/resolve-dry-run`, JSON `{"id":"<returned uuid>","confirm":"RESOLVE_DRY_RUN_ONLY"}`. Do not confuse simulated resolution with broker reconciliation.

## Important limitations

- IG `/history/transactions/ALL` may require endpoint-specific API headers/parameters and may fail or return a different schema. This is captured as a diagnostic failure, **not** a reason to guess daily P&L.
- Historical transaction rows alone are not certified daily realised/unrealised P&L.
- Five-second observations are sampled research quotes, not exchange-certified tick data.
- No real IG unknown-submit recovery, broker deal lifecycle, independent GBP pip value, delay verification or demo environment proof is completed by this upgrade.
- The v73 journal must reside on a genuinely durable Render disk to survive redeploys; a healthy file write alone is not proof of durability.
- The legacy `server.js` broker write guard is hard-coded false in this package. Do not change it.

## Local validation

`node --check server.js && node --check v73-recovery.js && node test-v73.js`
