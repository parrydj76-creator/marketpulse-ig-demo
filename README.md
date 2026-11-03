# MarketPulse AI V5.7 — IG DEMO automatic trading candidate

This is an **unverified deployment candidate**, not a tested unattended trading service. No live-money IG endpoint is used. The code can submit real **IG DEMO** orders once explicitly configured; it does not require approval per trade.

## Deployment
1. Back up your existing GitHub main branch. Upload server.js, paper-engine.js, package.json and public/ to the canonical repository.
2. Keep existing IG DEMO credentials and ADMIN_TOKEN in Render Environment. Do not commit secrets.
3. Set ENABLE_IG_DEMO_ORDERS=false and AUTO_START_DEMO_TRADING=false initially. Verify /api/state version 5.7.0 and streaming.
4. Render Free **cannot** run broker automation in this build: the code rejects execution without PERSISTENT_STORAGE_CONFIRMED=true. Do not set that flag on an ephemeral disk. Use paid always-on hosting with a correctly mounted persistent disk and verify files survive a redeploy.
5. Confirm IG EUR/USD CFD minimum position size, stop/limit distance units, contract value and valid spread from /api/admin/trading/preview, and set risk parameters. No default trade size is guessed.
6. Test a supervised demo order through the existing authenticated /api/admin/trading/manual-test route and confirm protective orders and close in IG DEMO.
7. After testing restart recovery and reconciliation, enable ENABLE_IG_DEMO_ORDERS=true, AUTO_START_DEMO_TRADING=true, PERSISTENT_STORAGE_CONFIRMED=true. The app will auto-arm after 30 consecutive stream-built 5-minute candles and other checks, then evaluate entries every 15 seconds without per-trade approval.

## Safeguards
- DEMO-only host and account type; broker-side stopDistance and limitDistance; max two entries/day by default.
- Durable pending-order journal before submitting an order. Any ambiguous response leaves pendingOrder non-null and blocks further entries; manual reconciliation required.
- Operator emergency stop persists and prevents auto-rearm; restart after errors is not automatically rearmed.
- Reconnect disarms, and auto-arm only occurs after stream recovery, reconciliation, and checks.
- Existing positions prevent new orders; tracked position may be managed by the strategy.

## Limitations
- This code has only been syntax checked, **not** integration tested with your IG account or Render service.
- It does not prove transaction-safe order handling across crashes, disk corruption, or simultaneous deployments. Do not assume unattended safety until end-to-end testing.
- Render Free spins down and has ephemeral storage; setting the storage confirmation flag there would be unsafe.
- The existing paper engine remains for comparison; IG DEMO execution is independent.
- The app's public /api/state contains trading diagnostics; protect the service appropriately.
