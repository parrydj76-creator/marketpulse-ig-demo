# MarketPulse AI v7.5 — staged monitoring upgrade

This is an experimental, monitoring-only upgrade based on the v7.2 source archive. It must be reviewed and tested on the live deployment before treating it as production-ready.

Changes: market-derived signal state (rather than paused paper-engine decisions), explanations of the 30 consecutive five-minute candle warm-up requirement, signal bar timestamp for deduplication, opt-in browser notifications while dashboard is open, fail-closed quote checks, and six new tests. No background iPhone push is provided: true background push requires a service worker, subscription storage and a push delivery service with iOS Home Screen app eligibility. No automatic historical bar backfill is included. Render Free restarts can still lose in-memory candle history.

No change to the hardcoded IG broker order blocks, paperRecoveryReady=false, or the paper reset lockout. Do not enable execution or paper trading.

Install only changed files in their matching repository paths: server.js, public/index.html, public/signal-view.js, tests/signal-view.test.js. Back up existing files. Run `node --check server.js && node --test tests/*.test.js` before commit. Verify `/api/state`, `/api/feed/health`, `/api/paper/recovery` after deploy. Ensure paper trading remains paused and broker execution blocked. No API keys or credentials should be uploaded.

If GitHub web upload fails, open files individually in GitHub's editor or use the Render Shell with an installer built from the current deployed code; do not paste ZIP bytes into Shell.
