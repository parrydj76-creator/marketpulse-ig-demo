# MarketPulse AI v37 — integrated paper-readiness upgrade

**No IG broker orders are sent by v37.** Legacy broker execution flags must remain disabled. This is not unattended broker trading.

## Changes
- Fixes v36 EUR/USD market eligibility by combining fresh REST `marketStatus=TRADEABLE` (maximum 6 minutes) and fresh streaming `DLG_FLAG=DEAL` (maximum 10 seconds), rather than confusing the two fields. Unknown or stale statuses reject entries.
- Adds independent, fsync-backed hash-chained v37 paper-readiness evaluation audit, including WAIT/rejected signals and feed diagnostics, every 30 seconds while v36 is enabled.
- Adds `/v37`, `/api/v37/status`, `/api/v37/evaluations`, `POST /api/v37/evaluate` (all admin-token protected).
- Keeps v36 paper positions and ledger intact. Its GBP P&L is **illustrative only**.
- Does not alter v36 strategy thresholds or force trades.

## Deploy
1. Back up existing GitHub repository and persistent disk. Upload this project to the existing repository, preserving Render environment variables and disk.
2. Ensure `BROKER_DEMO_EXECUTION=false`; do not enable any other legacy broker execution flags.
3. `npm test && npm run check`, then redeploy on Render.
4. Check `/api/v37/status`, `/api/v36/status` and `/api/state` with `X-Admin-Token`. The v36 paper engine starts **disabled** after every restart; operator must re-enable via `/api/v36/paper/start`.
5. For an audit evaluation: `curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v37/evaluate"`.
6. Access `/v37` in a browser with an authenticated admin session; otherwise use the JSON endpoints via curl.

## Still required before unattended IG DEMO broker orders
Independent GBP pip-value and minimum-size verification, instrument dealing-rule checks, broker open/close dealReference lifecycle, broker-side pending-order reconciliation, duplicate prevention, verified crash recovery, and explicit broker execution audit across legacy routes. No broker-write capability is added in this version.

## Known limitations
- v37 audit may grow indefinitely; plan archival and bounded storage before long-term operation.
- v36 remains illustrative and its risk/exit model does not account for slippage, gaps, commissions, financing, or realistic fills.
- v37 diagnostics are a separate journal from v36 trades; readiness is not broker authorization.
- If Render has multiple running processes, use a single authoritative paper writer or add an interprocess lock before trusting the audit.
