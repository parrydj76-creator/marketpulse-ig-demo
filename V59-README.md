# MarketPulse AI v59 — IG DEMO certification workbench

This release adds a **read-only** IG DEMO verification workbench. It does not enable unattended trading, place orders, or certify GBP sizing, broker order lifecycle, crash recovery, or unattended execution. Its purpose is to collect durable read-only broker evidence while preserving v58 paper trading.

## Deploy

Back up the current repo and persistent disk. Extract ZIP contents to the root of the existing GitHub repo. Preserve all Render environment variables and disk data. Ensure `ENABLE_IG_DEMO_ORDERS=false`, `MP_V65_DEMO_EXECUTION=false`, `AUTO_START=false`, and `IG_DEMO_ORDER_LIFECYCLE_VERIFIED=false` (or leave them unset). Never enable broker write flags to test v59. Deploy to Render.

## Check

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v59/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v59/check" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v59/evidence" | python3 -m json.tool
```

`/v59` is a basic authenticated read-only dashboard. API routes require the existing admin token. Browser authentication behaviour depends on your existing application auth middleware.

## Safety and next phase

The v59 module only calls IG `/accounts`, `/positions` and `/markets/{epic}` using GET. It stores hash-chained evidence on the persistent disk, fails closed on corrupted journals, and exposes 409 errors for v59 order and arming endpoints. **Important:** the existing legacy application has separate execution code and configuration flags; ensure those remain disabled. Read-only metadata is not certification of GBP-per-pip or real broker lifecycle.

Before unattended IG DEMO dealing, separately implement and test a supervised, operator-confirmed lifecycle harness, verified contract sizing in GBP, attached stop verification, unknown-order reconciliation after crashes, and a fail-closed execution adapter. No automatic trading readiness is claimed in v59.
