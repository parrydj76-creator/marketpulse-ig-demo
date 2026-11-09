# MarketPulse AI v38 — controlled IG DEMO verification

This release is a substantial **verification and instrumentation upgrade**, NOT a broker automation release.

## New endpoints (all admin protected)
- `GET /api/v38/status`: live readiness matrix and evidence journal health.
- `GET /api/v38/evidence`: recent hash-chained, operator-reported evidence.
- `POST /api/v38/evidence`: append a classified operator note. Does not certify it.
- `POST /api/v38/sizing/check`: provisional GBP-risk calculation, **never** certifies IG contract size or permits broker orders.
- `GET /v38`: simple dashboard (requires existing admin authentication).

## Deploy
Replace project files with ZIP contents, preserving existing Render environment and persistent disk. **Set `BROKER_DEMO_EXECUTION=false` before deployment**. Note: older server routes may exist; v38 does not audit or remove all legacy write routes.

## Verify from Render Shell
```bash
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v38/status" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v37/status" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v36/status" | python3 -m json.tool
```

## Broker readiness limitations
- Independent broker-specific GBP/pip sizing, quote-currency conversion and deal-size increments remain uncertified.
- End-to-end demo broker lifecycle (intent -> submit -> confirm -> open -> close) not certified.
- Broker reconciliation and restart recovery not certified.
- v36 paper ledger has not yet demonstrated a completed automatic trade on Render.
- `brokerOrderAllowed` always false for v38; evidence notes cannot flip readiness to certified.
- Do not enable unattended IG DEMO execution or set `BROKER_DEMO_EXECUTION=true` based on this release.
