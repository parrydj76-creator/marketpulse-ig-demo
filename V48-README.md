# MarketPulse AI v48 — EUR/USD Mini readiness

This release adds **read-only** IG DEMO EUR/USD Mini inspection. It **does not enable unattended broker trading**. All three v47 certifications remain unverified, and no broker order-write adapter is installed in v48.

Verified IG DEMO epic: `CS.D.EURUSD.MINI.IP`; contract size 10,000; IG-reported pip value 1.00; minimum deal size 0.1; minimum normal stop distance 2 POINTS. Deal-size *increment* and exact stop-unit semantics have not been independently certified.

## Endpoints (require existing X-Admin-Token)
- `GET /api/v48/status`: current readiness and blockers (no IG request)
- `POST /api/v48/inspect-mini`: authenticated, read-only `GET /markets/CS.D.EURUSD.MINI.IP`
- `POST /api/v48/arm-unattended`: always HTTP 409, no order submission

From Render Shell:

```sh
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v48/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v48/inspect-mini" | python3 -m json.tool
```

No new secrets or environment variables are required. Keep broker execution disabled. Before any future unattended order submission, independently validate GBP pip value, conversion and fees, deal increments, stop/limit semantics, actual broker order lifecycle including rejection and partial/unknown outcomes, durable recovery and account/position reconciliation, exposure and loss limits, stale quote protections, and kill switch. This package is not production-ready unattended execution.

## GitHub
Unzip and upload the extracted **contents**, not the ZIP file. Preserve folders. Do not remove existing repository files before validating deployment. `node --test v48-mini.test.js` checks v48's fail-closed behavior.
