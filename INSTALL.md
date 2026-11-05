# MarketPulse AI v9.1 — Automated Paper Trading Diagnostics

CHANGED FILES ONLY. Based on the v9.0 files previously supplied for this project. Back up your current repository first and compare `server.js` if it has changed since v9.0.

## Upload to GitHub (preserve paths)
- `server.js` — wires post-commit paper trade events to the existing push system
- `v9-paper.js` — adds in-memory tick/signal/rejection diagnostics; persistent simulation state and event history unchanged
- `push-alerts.js` — retains subscription, test, and existing signal APIs; adds paper OPEN/CLOSE notification delivery
- `public/v9.html` — new mobile-friendly dashboard with live activity and admin-protected trade history
- `tests/v9-paper.test.js` — existing deterministic simulation tests

Do NOT replace `public/push-ui.js`, `public/sw.js`, package.json or environment variables. Upload the files to the same relative locations, commit and deploy Render. No new environment variables required.

## After deploying
1. Open `/api/v9/paper/status`; verify `ready:true`, `brokerExecution:"BLOCKED"`.
2. Open `/v9`. Expect `PAUSED` after Render restarts. Enter your existing `ADMIN_TOKEN` directly into the app, then click **Start paper automation** once after verifying any saved open position.
3. Wait for market data to accumulate and watch **Last evaluation**, **Last streaming quote**, **Signal**, and **Decision**. `WARMING_BARS_*`, `STALE_QUOTE`, `SPREAD_TOO_WIDE`, `Daily entry cap`, `No qualifying signal` are expected possible reasons.
4. Click **Load trade history** with the admin token. Existing v9.0 PostgreSQL state and trade records are retained; no resets/migrations are made.
5. On iPhone, confirm your existing push test still works. Simulated OPEN/CLOSE push notifications are best effort and occur only after an actual persisted simulated trade event; there is no forced trade/test order in this upgrade.

## Safety / limitations
- **IG broker execution remains blocked by the existing `openDemo` hard throw.** v9.1 has no IG order submission capability. Never change the execution flags to bypass this.
- **After restart, new paper entries are paused** until you explicitly re-enable them. Open simulated positions are persisted in PostgreSQL.
- **Notification delivery is best effort** after DB commit. A process crash between commit and push may lose that notification; push acceptance does not prove display. This is not yet a durable push outbox.
- **Diagnostics are in-memory** and reset on restart. Simulation state/history are persistent. A 15-second evaluation interval is not a latency guarantee, and server hosting may suspend.
- **Simulation risk is illustrative**, not broker contract sizing. Risk 0.25% planned stop, 1% realised daily loss stop, 2 entries/day. Does not include all execution costs/slippage. No claims of profitability.
- The old v8 `2/2` trade counter is separate from v9.1 `dailyOpens`; use `/v9` for v9 simulated activity.
- Broker lifecycle, actual GBP contract value, margin, currency conversion, minimum size/stop distance, position reconciliation and restart-safe IG DEMO execution remain unverified. **No automated IG orders yet.**

## Tests
`node --check server.js`
`node --check v9-paper.js`
`node --check push-alerts.js`
`node --test tests/v9-paper.test.js`

## Rollback
Restore previous server.js, v9-paper.js, push-alerts.js and public/v9.html and redeploy. Do not delete PostgreSQL tables.
