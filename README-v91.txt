MarketPulse v9.1 — IG DEMO read-only risk and broker-state inspection

GitHub: replace server.js, add marketpulse-v91-lab.js, replace public/operations.html. Keep all previous modules unchanged. Deploy Render and open /operations.html.

Use the v9.1 Inspect button to read seven IG DEMO markets, GBP/USD conversion quote, and GET /positions. All returned monetary values are INDICATIVE ONLY; deal-size conventions and POINTS-to-pips are not independently verified. No IG broker writes.

The Engage local safety latch button writes a fail-closed flag to persistent DATA_DIR; it does NOT close/cancel orders, and does not certify a broker-connected kill switch. Existing broker execution is already hard-blocked. No button disarms it.

A genuine IG broker order lifecycle test (submit, confirm, reconcile, close), crash-recovery test, and broker kill switch certification cannot be truthfully completed by a GET-only package. Those require a separately controlled IG DEMO operator test with independent validation and robust hosting.

Endpoints: GET /api/admin/v91/lab; POST /api/admin/v91/inspect (GET-only IG calls); POST /api/admin/v91/kill (local persisted latch). Admin token required. Never share token.
