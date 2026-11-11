# MarketPulse AI v82 — Unattended Paper Trading Supervisor

This is an **additive** upgrade to an existing v81 deployment. It does **not** enable IG DEMO broker orders. It does not certify broker monetary sizing, exchange-feed entitlement, daily net P&L or order lifecycle.

## Files
- `v82-readiness.js`: read-only health/readiness evaluator, hash-linked audit journal, deterministic offline replay function.
- `v82-dashboard.html`: mobile-friendly authenticated status view.
- `v82-integration-snippet.js.txt`: copy the snippet into your existing `server.js` after the v81 block, before catch-all routes.
- `test-v82.js`: offline tests; run `node test-v82.js`.

## Installation
1. Back up GitHub repository and persistent disk. Keep existing `server.js`, v54 safety, v68, v71, v80 and v81 modules.
2. Upload `v82-readiness.js` and `v82-dashboard.html` alongside `server.js`.
3. Merge the integration snippet exactly once; confirm the v81 variable is named `v81Simulator` (as in the original v81 integration). Do not replace your entire server.
4. Commit and redeploy to Render. Ensure Render persistent disk remains mounted at the existing `DATA_DIR` and legacy broker execution flags remain disabled.
5. In Render Shell, test with:

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v82/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v82/audit" | python3 -m json.tool
```

Dashboard `/v82` uses existing authentication. A 403 in the browser means it cannot supply the admin header; use the authenticated API via Render Shell instead.

## Important limitations
- v82 **supervises** the existing v81 paper engine, and does not modify its execution decisions. The v81 illustrative £1/pip/unit assumption remains uncertified.
- The replay helper is deterministic and offline, not a historical backtest data fetcher or evidence of real broker fills. Sampled quotes can skip stop levels; it uses the first observed exit quote.
- v82 does not fix the actual IG transaction date format; real record format/timezone must be independently established before certified net P&L.
- `certified`, `brokerOrderAllowed`, and `unattendedOrderAllowed` remain false regardless of status. A later supervised, separately approved DEMO lifecycle test is required.
