# MarketPulse AI v10.0 — Automation Control Centre

**Read this first:** This is a read-only broker-readiness and risk-audit upgrade, NOT a broker execution release. IG order execution remains hard-blocked in the existing server. The v9 PostgreSQL state and history are preserved.

## Install
1. Back up current GitHub files. Do not reset your PostgreSQL database.
2. Upload `server.js`, `v10-readiness.js`, and `public/v10.html` to the same relative paths in your existing repo. Upload `tests/v10-readiness.test.js` if desired. `v9-paper.js`, `push-alerts.js`, and `public/v9.html` are included as reference copies only; **do not overwrite working copies unless identical**.
3. Commit to main and deploy Render. No new environment variables or packages are required.
4. Open `https://marketpulse-ig-demo.onrender.com/v10`. Paper entries pause after a Render restart; inspect the saved position before restarting simulation.
5. Enter existing `ADMIN_TOKEN` directly in your own app; run Risk Audit and Read-only Broker Check. Do not share tokens.

## What is new
- Mobile-friendly unified v10 dashboard with v9 paper status, diagnostics, open position, history, and controls.
- Authenticated virtual-risk audit: entry cap, daily realised loss, protective level orientation, virtual pip risk and projected open stop risk against remaining daily loss budget.
- Authenticated read-only IG GET `/markets/CS.D.EURUSD.CFD.IP`, `/positions`, `/accounts` to display market specifications and readiness checklist.
- Explicit unverified blockers for actual GBP-per-pip contract value, order lifecycle, idempotency and restart reconciliation.
- No order submission or changes to broker execution flags.

## Known gaps
- The risk audit is **observational**: it flags an open-risk breach but does not alter the existing v9 strategy or enforce new limits. Paper trading remains simplified.
- IG dealing rule values and units require human verification. This report does not establish minimum order size suitability, stop units, actual exposure or profitability.
- Broker check can fail if IG session credentials are expired or rate limited. Do not treat failures as readiness.
- v9 simulated exits require valid market/bars and the paper engine must be tested across a Render restart. Broker order lifecycle is not implemented.
- Only one running Render instance is assumed for the v9 paper engine; multi-instance coordination is not verified.
- Notifications remain best effort; existing push files are unchanged.

## Test locally
`node --check server.js`
`node --check v10-readiness.js`
`node --test tests/v9-paper.test.js tests/v10-readiness.test.js`

## Rollback
Restore previous server.js and redeploy. No schema changes or data deletion.
