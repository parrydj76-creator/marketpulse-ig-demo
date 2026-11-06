# MarketPulse AI v12.0 — Execution Validation Centre

## What it does
Adds a dedicated `/v12` dashboard and authenticated, read-only diagnostics: completed paper trade P/L audit, PostgreSQL event/state consistency check, and IG DEMO market evidence inspection. It retains v11 journal, v10 risk audit, v9 paper trading, and existing iPhone push alerts. **No IG orders are placed.**

## GitHub / Render installation
1. Back up your current repository and Render environment variables. Keep the existing PostgreSQL database.
2. Upload/replace `server.js` in the repository root (based on v11.0). Add `v12-validation.js` in the root.
3. Add `public/v12.html` inside `public`. Optionally add `tests/v12-validation.test.js`.
4. Keep `v9-paper.js`, `v11-execution-lab.js`, `v10-readiness.js`, `push-alerts.js`, `public/sw.js`, `public/v10.html`, and all other files as they are.
5. Commit to `main`; wait for Render deployment. Open `https://marketpulse-ig-demo.onrender.com/v12`.
6. Enter your existing `ADMIN_TOKEN` **inside the app only**. Run Refresh status, Audit completed trades, Check recovery consistency, and Read-only IG evidence.
7. After deployment, paper entries are expected to be paused; review open positions before restarting the simulator.

## Important safety boundaries
- `server.js` retains the existing hard-block on IG broker order execution. No new broker POST endpoints or execution toggles are introduced.
- The v12 IG diagnostic uses only authenticated read-only GET calls. Market data rules alone do NOT establish GBP/pip contract value, margin, or valid order size.
- Exit arithmetic verifies virtual calculations only; it does not verify real fills, spread, slippage, or broker lifecycle.
- The recovery report checks database consistency but does not prove restart recovery. A controlled restart and concurrency tests remain necessary.
- Exit audit reads up to 1000 events and reports if history is truncated; it cannot certify complete history in that case.
- All status/audit endpoints require ADMIN_TOKEN; never paste secrets into chat or screenshots.

## Local checks
`node --check server.js`
`node --check v12-validation.js`
`node --test tests/v12-validation.test.js`

## Rollback
Restore the previous v11 `server.js`; the v12 module is additive and does not migrate or delete database tables.
