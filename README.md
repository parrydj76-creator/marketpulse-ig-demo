# MarketPulse v25 autonomous simulation add-on

This is an **additive prototype**, not a complete deployable application: the uploaded server depends on many additional local modules and `public/` files not supplied. Keep those existing files in your GitHub repo. Replace `server.js`, add `v25-autonomy.js`, and optionally add `tests/v25.test.js`. The supplied `package.json` is unchanged.

## Safety

IG broker orders remain HARD_BLOCKED. All trades and GBP P&L are **illustrative**, using a manually configured GBP-per-pip assumption, not verified IG sizing. No broker POST calls are made by the new module. Stops are simulated and are evaluated only when the process receives a qualifying streaming quote; they are not broker-guaranteed. The simulation pauses after restart and preserves an open simulated position for inspection. No automated restart recovery or production-safe storage guarantees are claimed. Do not enable IG order flags.

## Deploy

1. Back up your GitHub project. Keep all preexisting modules and public dashboard files.
2. Upload `server.js` and `v25-autonomy.js` to the repository root.
3. Keep existing Render environment variables; do not set `ENABLE_IG_DEMO_ORDERS=true`.
4. Deploy and check `/api/health` then use authenticated API endpoints with `X-Admin-Token` header.
5. GET `/api/v25/status` to inspect, POST `/api/v25/start` to start simulation, POST `/api/v25/stop` to stop. PUT `/api/v25/config` with a complete numeric config object from status to change assumptions while paused and flat.
6. Run `node --test tests/v25.test.js` locally.

## Limits

Only EUR/USD; no broker orders, no real-time UI upgrade, no alerts, no historical backtest, no independent broker contract validation. The daily limit uses UTC and realized simulated P&L; it is not a broker risk control. Persistent storage must be configured for continuity across Render restarts.
