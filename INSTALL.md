# MarketPulse AI v9.0 — paper automation upgrade

This is a **changed-files-only** ZIP for the existing GitHub/Render project. It is NOT a complete standalone repository.

## Included paths (upload preserving folders)
- `server.js` — based on the user's uploaded working v8 server, adds independent v9 paper module and `/v9` dashboard.
- `v9-paper.js` — new PostgreSQL-backed simulation engine. Does NOT call IG order endpoints.
- `public/v9.html` — new mobile-friendly simulation dashboard.
- `tests/v9-paper.test.js` — deterministic unit tests.

## Install
1. Back up your current GitHub `server.js` before replacing it. If you have edited it since the uploaded copy, compare the changes first; don't overwrite newer work.
2. Upload all four paths to the **repository root**, preserving `public/` and `tests/` folders.
3. Keep your existing `push-alerts.js`, `public/push-ui.js`, `public/sw.js`, `package.json`, and environment variables unchanged.
4. Commit to `main`. Render should deploy automatically; if not, choose Deploy latest commit.
5. Open `/api/v9/paper/status`: check `ready:true`, `enabled:false`, and `brokerExecution:"BLOCKED"`.
6. Open `https://marketpulse-ig-demo.onrender.com/v9` on your iPhone. Enter your existing Render `ADMIN_TOKEN` into the field **only on your own app**; tap Start paper automation. This enables simulated entries only, and never IG orders.
7. Verify `/api/push/status` still shows ready:true and the existing push test still works.

## Important operational details
- On every restart, **new simulated entries start paused**, even if they were enabled previously. Existing simulated positions remain in PostgreSQL and are managed on fresh verified ticks; resume explicitly to allow new entries.
- Only EUR/USD, undelayed IG STREAM quotes with marketState `DEAL`, max 15 seconds old, spread <=2 pips and 30 consecutive sampled 5-minute bars are eligible. The feed may need hours of uninterrupted observations to warm up.
- The simulator uses **virtual £10,000 equity**, 12-pip stop, 18-pip target, max 180-minute hold, and signal score >=70. Risk 0.25% of current virtual equity; stop sizing is an accounting simulation, not verified IG contract sizing.
- The **1% daily loss stop is based on realised simulation P/L**, not intraday unrealised P/L. Stops are evaluated at observed bid/ask, not guaranteed execution. Gaps, latency, spreads, and fees can cause losses above 0.25% and 1% in practice.
- This is not a backtested or validated profitable strategy. There is no historical replay, market-news filter, actual broker position reconciliation, or automatic broker order execution.
- The existing broker `openDemo` monetary-risk block is **unchanged**. No new endpoint can place broker orders. Do not enable IG DEMO orders through environment variables until separately verified.
- PostgreSQL must be available; if database setup or tick processing fails, paper automation fails closed and needs investigation.
- The separate legacy paper module remains unchanged and paused; v9 simulation is independent to avoid disrupting its recovery controls.
- Existing iPhone push delivery and manual test are unchanged; automatic trade-event push notifications are **not yet integrated**.

## Tests
`node --test tests/v9-paper.test.js`
`node --check server.js`
`node --check v9-paper.js`

## Rollback
Restore the prior `server.js` in GitHub, redeploy, and leave the `mp_v9_paper_*` PostgreSQL tables untouched until you've exported their records. Removing the v9 module does not change existing IG or push modules.
