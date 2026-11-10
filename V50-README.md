# MarketPulse AI v50 — Mini certification workbench

Upgrade built on the supplied v49 repository. Retains legacy modules and routes.

## Dashboard

Open `/v50` on your Render service and enter your admin token to view authenticated status. Token is held only in page memory, not stored. Do not expose the token.

## Admin API

- `GET /api/v50/status` — readiness and evidence summary
- `GET /api/v50/events` — hashed journal event summaries
- `POST /api/v50/inspect` — read-only IG Mini market, account and position snapshot
- `POST /api/v50/risk-preview` — GBP risk evidence candidate; never self-certifies
- `POST /api/v50/observe-open` — body `{"dealId":"..."}`; read back operator-opened Mini position with protective stop and limit
- `POST /api/v50/observe-close` — body `{"dealId":"..."}`; read back absence after prior observation; not independent fill confirmation
- `POST /api/v50/reconcile-after-restart` — body `{"dealId":"..."}`; requires prior boot observation and matching Mini broker position
- `POST /api/v50/simulate` — simulated risk-gated order proposal; no IG writes
- `POST /api/v50/emergency-stop` — body `{"confirm":"STOP_V50_SIMULATION"}`; persistent v50 simulation kill switch (does NOT stop legacy trading)
- `POST /api/v50/arm-unattended` — always rejects with HTTP 409

All API endpoints require `X-Admin-Token` and must be called over HTTPS from outside Render.

## Safeguards and limitations

- No v50 broker order-write adapter is connected or enabled. No claim of actual unattended trading.
- v50 emergency stop affects **v50 simulation only**. It does not disarm older trading modules or the IG account. Keep legacy execution flags disabled.
- Observations of broker positions and their absence do **not** prove confirmed open/close fills, fees, monetary P/L, or unknown-order recovery. Certification flags remain false pending independent evidence.
- v50 account currency is read from IG `/accounts` rather than guessed.
- Size increment and stop-unit evidence must be independently checked; minimum size is not necessarily an increment.
- The USD-to-GBP rate must be independently sourced and fresh. User-supplied evidence never automatically certifies the system.
- The journal requires durable storage and fails closed if integrity or writes fail. Back up existing journal before deploying; do not delete `/var/data`.
- Risk preview assumes two pips of slippage by default, not a guaranteed loss cap.
- A dedicated independent broker write adapter with idempotent intent recovery, protective order reconciliation, time-zone-aware daily limits, and kill switch must be separately implemented and tested before unattended trading can be enabled.

## Deployment

Unzip, upload all extracted files and folders to the existing GitHub repository preserving structure, and redeploy Render. Keep `ENABLE_IG_DEMO_ORDERS=false`, `MP_V65_DEMO_EXECUTION=false`, `AUTO_START_DEMO_TRADING=false`, `MP_AUTO_RESUME=false`.

Run `npm test` and `node --check server.js`. Then check `/api/v50/status`, POST `/api/v50/inspect` and the `/v50` dashboard.
