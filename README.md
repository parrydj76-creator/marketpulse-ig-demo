# MarketPulse AI V6.2.1 — Seven Major Forex Pairs (IG DEMO only)

This is the full server code patched from the supplied V6.1 project.

Allowed CFD EPICs: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD. No mini, minor, exotic or broad IG market-search requests. Startup discovery uses a local allowlist; IG still validates each market at execution.

## Deploy
1. Back up the existing GitHub repository.
2. Upload all files from this directory to the repository root, preserving your existing control.html if present.
3. Keep existing private IG DEMO credentials and ADMIN_TOKEN in Render.
4. Set environment variables as shown in render.env.example. Keep ENABLE_IG_DEMO_ORDERS=false and MP_AUTO_RESUME=false initially.
5. Deploy, check /api/state (marketCount should be 7) and /api/multi/status.
6. Wait for IG API allowance to recover if you still see 403 exceeded-account-allowance.

## Important safeguards
- This does NOT bypass IG rate limits; the account may still be temporarily rate-limited.
- Broker orders remain disabled by default. Per-pair contract size, currencyCode, stop units, minimum distance and order lifecycle must be independently verified.
- Render Free ephemeral storage cannot safely preserve the journal or daily trade counts after restarts. Auto-resume remains fail-closed without persistent storage and a restored journal.
- The app may still perform periodic account, snapshot and REST fallback calls. Avoid multiple Render instances using the same API credentials.
- No live-money trading. No guarantee of uninterrupted operation or profitable signals.

## V6.2.1 fix
Fixed the CommonJS export of `EPICS` in `multi-engine.js` so `require('./multi-engine')` does not throw `ReferenceError: EPICS is not defined`. The full deployment package is included.
