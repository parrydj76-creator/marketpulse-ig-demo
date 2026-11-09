# MarketPulse AI v34 — Paper automation orchestration

This full repository retains previous versions. v34 introduces a restart-disarmed 30-second paper-evaluation loop with conservative data gates, tamper-detecting chained journal, durable fsync/rename writes, read-only IG account and position observation, and a mobile-friendly dashboard at `/v34`.

## Deployment
Replace repository contents, retain existing Render environment and persistent disk. Run `npm test` and deploy. Verify `/api/v34/status` with `X-Admin-Token`.

## Endpoints
- GET `/api/v34/status`
- GET `/api/v34/events`
- POST `/api/v34/paper/start` (paper evaluation only)
- POST `/api/v34/paper/stop`
- POST `/api/v34/paper/cycle` (one evaluation, even if loop stopped)
- POST `/api/v34/broker/observe` (GET `/accounts` and GET `/positions` only)

## Security and limitations
- No IG broker order write calls. No unattended demo or live trading. Existing broker hard block remains.
- On restart paper loop is OFF, requiring operator to restart it.
- Every paper candidate is *only* a candidate, never an order; no P&L or fills are simulated here.
- Unresolved broker intent gate is deliberately set to fail-closed until v33 journal can be safely unified with a broker reconciliation process. This means all automatic paper evaluations currently reject with `UNRESOLVED_ORDER_INTENT`; use the dashboard to validate the pipeline and journal.
- Actual GBP sizing, stop execution, IG deal references and in-flight crash recovery remain uncertified. No performance claims.
- Admin token is entered locally in the dashboard and not persisted by the dashboard.
