# MarketPulse AI v17.0 — Automated Trading Readiness Suite

## GitHub installation
1. Back up your current GitHub repo and Render environment settings.
2. Replace the **root** `server.js` with the supplied file. This is based on the v16 server and adds the v17 route **before** the dashboard catch-all.
3. Add `v17-readiness.js` in the repo root.
4. Add `public/v17.html` in the public folder.
5. Optionally add `tests/v17-readiness.test.js` and run `node --test tests/v17-readiness.test.js`.
6. Keep all existing v9–v16 modules, `push-alerts.js`, `public/push-ui.js`, `public/sw.js`, existing public dashboards, package.json and PostgreSQL settings. **Do not replace or delete them.**
7. Commit and deploy to Render; open `https://marketpulse-ig-demo.onrender.com/v17`.

## First use
- Enter existing `ADMIN_TOKEN` only into your deployed app.
- Click **Refresh readiness** and **Evaluate live signal**. New v17 rehearsal is **HALTED by default**.
- To enable **simulation-only** intent preparation, explicitly click **Enable automatic simulated intents**. The server checks every 30 seconds; new qualifying completed signal bars are deduplicated in PostgreSQL. It prepares simulated intents only. Press **Halt v17 rehearsal** to stop it.
- The v17 daily limit applies only to new v17 simulated intents, NOT v9 paper trades. The v17 risk gate uses illustrative £10,000 equity, £25 planned risk and zero realised loss; it **does not enforce a real account-wide daily loss stop**.
- Monetary lab requires separately supplied pip-value, currency-conversion and size-unit assumptions. It does **not** verify IG contract rules or produce an executable broker size.

## Important limitations
- No IG broker orders, position fills, paper trades or broker-order reconciliation are performed by v17. Existing broker safety block must remain unchanged.
- This is NOT an end-to-end automated trading system. V17 automatically prepares simulation-only signal intents; it does not advance them through broker-like lifecycle transitions or execute trades.
- No new v17 push events are wired; existing push notifications are unchanged.
- No new performance analytics are claimed: v17 has only intent history, not actual P/L, win rate or drawdown. Existing v9 paper analytics are separate.
- `server.js` is based on the v16 supplied release. If your GitHub server has been modified since v16, compare and merge the v17 route addition rather than blindly replacing it.
- Default v17 halt is stored in PostgreSQL. An explicit start persists across restart; press Halt before deployment/restart if you do not want simulations to resume.
- Test the old `/`, `/v9`, `/v16` and push subscription functionality after deployment. The v17 module does not import the IG client.
