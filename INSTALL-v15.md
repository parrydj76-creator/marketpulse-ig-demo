# MarketPulse AI v15.0 — Execution Rehearsal Lab

## Installation
1. Back up your current GitHub repo and Render configuration.
2. Replace **root `server.js`** with the supplied version (based on the working v14 route fix).
3. Add **root `v15-rehearsal.js`** and **`public/v15.html`**.
4. Keep all existing v9-v14 modules, the `public` folder, service worker, push alerts, IG DEMO integration and PostgreSQL database. Do not overwrite `.env` or add secrets to GitHub.
5. Commit to GitHub, let Render deploy, then open `https://marketpulse-ig-demo.onrender.com/v15`.
6. Enter `ADMIN_TOKEN` only into your deployed app.

## What v15 does
- Runs a **one-click**, deterministic, SIMULATION-ONLY lifecycle rehearsal (ACK, REJECT, TIMEOUT_FOUND, TIMEOUT_ABSENT).
- Persists each final rehearsal outcome in PostgreSQL, with a deterministic ID and uniqueness constraint. It is not a real broker event log.
- Tests 8 simultaneous simulated requests from **one Node process** against PostgreSQL. This is not proof of multi-worker or crash safety.
- Audits virtual 0.25% planned risk, 1% daily realised-loss stop and 2-new-trades-per-day cap using supplied test figures.
- Keeps v15 automatic scheduling halted; the manual one-click simulation remains available. No automatic signal feed is connected to v15. Existing v9 paper trading is unchanged.
- No IG API client is imported into v15, no broker order is sent and the `openDemo` hard-block in server.js remains in place.

## Verify
Run `node --check server.js && node --check v15-rehearsal.js && node --test tests/v15-rehearsal.test.js`.
Run a rehearsal, refresh journal, repeat same timestamp/direction/scenario and confirm duplicate=true. Run the 8-request probe and confirm created=1, duplicates=7. Run risk audit with 2 trades today to verify rejection.

## Still unverified
IG GBP-per-pip and executable contract sizing; live broker order acknowledgement; real broker reconciliation; controlled restart while a submission is pending; cross-process concurrent requests; slippage and guaranteed maximum losses. Do not enable broker execution.

## Rollback
Restore your previous working `server.js`. The v15 tables can remain in PostgreSQL unused.
