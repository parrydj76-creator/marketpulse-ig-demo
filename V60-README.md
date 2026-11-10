# MarketPulse v60 — supervised execution design harness

This update is **read-only at the IG broker**. No IG dealing adapter is implemented, and no POST/PUT/DELETE dealing requests are made. Operator approval is a recorded simulation of an approval step, not authorization to send an IG order.

## Routes (all require existing admin authentication)
- GET `/api/v60/status`
- GET `/api/v60/events`
- POST `/api/v60/preflight` with `{}`: GBP account, broker positions, idle v58 paper engine and healthy v59 journal.
- POST `/api/v60/prepare` with `{ "intentId":"test-intent-0001", "epic":"CS.D.EURUSD.MINI.IP", "direction":"BUY", "size":0.1, "stopPips":12, "targetPips":18, "indicativeRiskGBP":0.9 }`: writes a non-executable, duplicate-protected intent. Risk figure is illustrative, not broker-certified.
- POST `/api/v60/approve` with `{ "intentId":"test-intent-0001" }`: records operator approval for a **future** supervised test only.
- POST `/api/v60/reconcile` with `{}`: read-only broker readback; unresolved prepared intents are flagged for human review, not automatically resubmitted.
- GET `/v60`: compact status dashboard.

Broker execution endpoints reject requests with HTTP 409. Restarts recover the hash-chained journal. No certification flags are automatically promoted. Never enable legacy execution flags to work around these controls.

## Remaining before actual unattended IG DEMO execution
Independent verification of contract GBP risk, actual supervised broker open/confirm/close with stops, ambiguous in-flight submission reconciliation, kill-switch, rate limits, account locking, market status and permission controls. An approved design intent is NOT a broker order.
