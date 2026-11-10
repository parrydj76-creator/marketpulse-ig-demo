# MarketPulse AI v54 — pre-execution safety harness

GitHub-ready flat ZIP. Upload files to the existing repo and redeploy Render. Preserve Render environment variables and persistent disk.

## Critical change
All outgoing IG requests other than GET and POST /session are rejected centrally in `request()` with `V54_BROKER_WRITE_HARD_BLOCKED`. This includes legacy routes, and means v54 cannot place, edit, or close an IG trade. This is deliberate until independent certifications and a tested adapter exist. **Existing broker positions must be managed directly in IG.**

## Read-only checks in Render Shell

```sh
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v54/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v54/reconcile" | python3 -m json.tool
```

`POST /api/v54/propose` records an **unsubmitted** intent for review, requires an explicit clientIntentId and indicative FX/pip values, rejects duplicates, existing Mini positions and earlier unresolved proposals. This is not broker-certified risk sizing. There is intentionally no operator reset of recorded proposals; use a new audited workflow after review.

`POST /api/v54/emergency-stop` persists a safety stop for v54 proposals; it does **not** close broker positions or replace IG risk controls.

### Still required before unattended execution
Broker-verified Mini lot increments and stop units; independent live FX and GBP risk cross-check; exact broker confirmation and closing P/L; durable unknown-submission reconciliation; multi-instance fencing and atomic database transactions; live broker readback and manual supervised DEMO lifecycle; reviewed risk limits and kill-switch.

Do not set `ENABLE_IG_DEMO_ORDERS` or other legacy execution flags. The new central hard block overrides them but leaving them off avoids misleading UI states.
