# MarketPulse AI V5.9 — Render Free IG DEMO experimental

This version removes the **durable-storage hard requirement** for IG DEMO orders when `ALLOW_EPHEMERAL_IG_DEMO=true`. It does NOT enable real-money trading. It is a best-effort experimental build, not a reliable 24/7 trading service.

## Install
1. Back up your existing GitHub repository, then upload these files to the canonical `main` branch.
2. In Render, configure your existing DEMO credentials and `ADMIN_TOKEN` as secret environment variables.
3. Start with `IG_ACCOUNT_TYPE=DEMO`, `ALLOW_EPHEMERAL_IG_DEMO=true`, `PERSISTENT_STORAGE_CONFIRMED=false`, `ENABLE_IG_DEMO_ORDERS=false`, `AUTO_START_DEMO_TRADING=false`, `IG_DEMO_ORDER_LIFECYCLE_VERIFIED=false`.
4. Redeploy; check `/api/state` reports `version=5.9.0` and `storage.ephemeralDemoOptIn=true`.
5. Use the authenticated `/api/admin/trading/preview` endpoint to inspect IG dealing rules. Verify minimum size, stop units, contract exposure and available demo funds; then configure demo trade settings. Do not guess these values.
6. After broker integration tests, set `ENABLE_IG_DEMO_ORDERS=true` and redeploy. The authenticated `/api/admin/trading/manual-test` endpoint requires a deliberate demo-only test request and 30 consecutive 5-minute streaming candles. Inspect the order, broker-side stops, confirmation, and close in IG.
7. Only after independently verifying an open/close/restart lifecycle should `IG_DEMO_ORDER_LIFECYCLE_VERIFIED=true` be set. `AUTO_START_DEMO_TRADING=true` then allows automatic arming after all remaining checks pass. No per-trade confirmation is needed.

## Major limitations
- Render Free sleeps/restarts; trading stops during downtime and may miss signals.
- The local daily counter, cooldown, signal history and order journal may reset after a restart. The bot will refuse new orders when it sees existing IG positions, but cannot reliably reconstruct all historical trades or unresolved submissions. **Do not rely on the local daily cap as a hard limit in ephemeral mode.**
- A pending order may have been accepted even if the API times out. Never retry an uncertain order until it is independently reconciled in IG.
- Broker-side attached stop and limit orders are critical; check they are actually present in the IG demo platform.
- Only EUR/USD CFD is supported for demo execution.
- Keep real IG accounts and credentials entirely separate.

This release is a source-code update. Syntax validation is not proof that IG broker orders work.
