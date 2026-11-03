# MarketPulse AI V6.1 — Dynamic IG Demo Forex Discovery

This extends V6.0 to discover forex CFD pairs rather than hardcoding three. It searches a broad currency cross-set and includes IG-reported eligible CFD markets, up to `DISCOVERY_MARKET_LIMIT` (default 150). IG discovery/search results and subscription capacity may limit coverage; it does **not** guarantee every IG forex instrument will be found. Add missing exact EPICs to `IG_EPICS` if needed.

## Install
Upload `server.js`, `multi-engine.js`, `paper-engine.js`, `package.json`, and `public/multi.html` to your GitHub repository; preserve existing `public/control.html`. Keep private credentials in Render only. Start with `ENABLE_IG_DEMO_ORDERS=false`, `MP_AUTO_RESUME=false`, `MP_MULTI_MODE=true`, `TEST_ONE_FOREX=false`. View `/multi` and `/api/multi/status`.

## Per-pair configuration
For `GBPJPY`, set `MP_GBPJPY_ENABLED`, `MP_GBPJPY_SIZE`, `MP_GBPJPY_STOP_POINTS`, `MP_GBPJPY_LIMIT_POINTS`, `MP_GBPJPY_MAX_SPREAD_PRICE`, `MP_GBPJPY_MIN_SCORE`, `MP_GBPJPY_VERIFIED_MIN_SIZE`, `MP_GBPJPY_POINT_UNITS_VERIFIED`, `MP_GBPJPY_LIFECYCLE_VERIFIED`, and `MP_GBPJPY_CURRENCY_CODE`. **Do not copy EUR/USD point distances, deal sizes or spreads to other pairs.** Validate broker market rules and run a controlled demo lifecycle test per pair before enabling it.

## Safety / limitations
No live-account orders. Dynamic discovery does not mean all pairs are streamed concurrently: `MAX_STREAM_MARKETS` caps subscriptions at 40, default 20. Pairs outside the active stream are not eligible for automated orders. An enabled but unverified pair halts the automatic engine (fail closed). Render Free has no durable journal: unattended auto-resume remains blocked; do not set `PERSISTENT_STORAGE_CONFIRMED=true` without actual persistent storage. Environment settings persist, but pending orders and daily trade counts do not. This release is syntax-tested, not broker integration-tested.
