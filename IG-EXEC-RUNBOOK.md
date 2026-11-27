# IG DEMO autonomous execution — runbook

## What was added (nothing existing was rewritten)
- `ig-exec/` — IG REST client, execution engine, risk manager, Postgres store, kill-switch routes. 16 tests.
- `server.js` — 6 added lines before `const sim2000=`, plus one call inside `tick2000`. When the v2000 paper engine
  enters a trade, the same signal is sent to the broker engine. The legacy `BROKER_DEMO_EXECUTION=false` and every old gate are untouched.
- `public/ig-exec.html` — phone-friendly status / **KILL SWITCH** / resume page (`/ig-exec.html`, needs ADMIN_TOKEN).
- New tables are created automatically on first start: `ig_orders`, `ig_positions`, `bot_state`, `audit_log`.

## How a trade flows
paper engine `PAPER_ENTRY` → adapter (signal id = `epic:bar`, size = `IG_EXEC_SIZE`) → risk checks → order saved to DB →
IG market order with broker-side stop + limit → confirmation → position stored → reconciled with IG every 15s →
exits by broker stop / limit, 3-hour time exit, or kill switch.
Paper and broker run side by side; the broker engine is authoritative for real DEMO positions.

## Step 0 — prove it against real IG DEMO (on your own computer, ~5 minutes)
```
cd ig-exec
IG_API_KEY=... IG_USERNAME=... IG_PASSWORD=... IG_DEMO_ACCOUNT_ID=... \
IG_EXEC_EPICS=CS.D.EURUSD.CFD.IP IG_EXEC_SIZE=0.5 node scripts/demo-acceptance.js
```
Needs 14/14 PASS. Pay most attention to check 3 (stop distance in pips matches what we asked) and the printed
INSTRUMENT FACTS: use them to set a safe `IG_EXEC_SIZE` and `IG_PIP_VALUE_GBP`. If anything FAILs, send me the output.
Run it while the FX market is open (not weekends).

## Step 1 — deploy
Render env vars (secrets stay in Render): see `render.env.example`. Minimum:
`IG_EXEC_ENABLED=true  IG_DEMO_ACCOUNT_ID  IG_EXEC_EPICS=CS.D.EURUSD.CFD.IP  IG_EXEC_SIZE`  (plus your existing IG_* and ADMIN_TOKEN, DATABASE_URL).
Keep `numInstances: 1` and a paid always-on plan (free tier sleeps = not unattended).
First start is **KILLED by design**. Open `/ig-exec.html`, enter ADMIN_TOKEN, press **Resume** once.
After that it survives restarts and redeploys unattended (the kill state is remembered either way).
Also start the paper simulation in the existing dashboard (`/api/admin/v2000/start`) — the broker engine only trades on its signals.

## Phase plan
1. **Week 1:** one pair, minimum size. Check daily: orders = IG demo platform, no stuck/UNKNOWN orders, `/history`.
2. **Weeks 2–4:** add pairs one at a time via `IG_EXEC_EPICS`. Defaults: 1 open position, 3 orders/day, 180-min max hold, daily loss limit £50 (estimated P&L).
3. Change risk without redeploy: `PUT /api/admin/ig-exec/risk` (fields in `ig-exec/src/execution/risk.js`).

## Safety summary
Demo host only + session account must equal `IG_DEMO_ACCOUNT_ID` + demo Lightstreamer endpoint (all checked on login and on every request);
7 major CFD epics only; disarmed unless `IG_EXEC_ENABLED=true`; killed until first Resume; same signal can never trade twice; ambiguous network failures
are never resent (resolved via IG confirms); broker stop mandatory (attached or position closed); 5 consecutive reconcile failures block new orders.

## Not verified (could not test from here)
- Anything against real IG — Step 0 is the proof. The mock follows IG's documented API, not IG.
- Postgres store (tested via an in-memory twin of the same interface).
- Realised P&L is estimated from price levels × `IG_PIP_VALUE_GBP`; use IG's transaction history for true figures.
- Market orders can slip; the strategy's 12/18 pip stop/target vs up to 2 pips of spread is thin, so expect demo results to differ from paper.
- A separate login is used for execution (the existing app session is not shared). If IG ever limits concurrent sessions on your key, tell me.
- One existing repo test (`v23.test.js` "server hard block is preserved") already failed before my changes: it looks for an `openDemo` function that no longer exists.

## Real money — not enabled, deliberately
This build refuses anything but DEMO in three places, and the repo's own `IG_ACCOUNT_TYPE=DEMO` check still applies. Suggested gate before a live trial:
Step 0 passes; ≥4 weeks and ≥100 broker-side demo trades; zero unreconciled/UNKNOWN orders and zero manual interventions; results measured **after** spread
and slippage still positive (not just paper P&L); kill switch tested on a phone. Even then, the demo only proves the plumbing works, not that the strategy makes money
(a simple 5-min RSI/EMA rule; the repo has no evidence of an edge), and IG's own risk warning says most retail CFD accounts lose money. If you get there, start with a
size you'd be happy to lose entirely. I can then add a separate hardened live profile (own account allow-list, tiny size cap, tighter loss limit, second explicit switch).

## Findings from the first real DEMO run (EURUSD CFD, 26 Nov 2026)
- IG minimum deal size = **1** (1 contract = 100,000 units, about $10 per pip). `IG_EXEC_SIZE` must be >= 1; the engine now refuses smaller sizes locally.
- At size 1 a 12-pip stop risks about $120 (about £90), a 18-pip target is worth about $180, and the quoted spread was about 0.9 pip. The paper engine assumes £25 risk, so paper P&L understates demo (and any live) money at risk by roughly 3.5x.
- Set `IG_PIP_VALUE_GBP=7.6` (about $10 / GBPUSD 1.31) so estimated P&L and the daily loss limit are on the right scale. With the default of 1 the loss limit would be ~7x too lenient.
- With the default £50 daily loss limit, one stop-out ends trading for the day. That is intentional.

## Acceptance result (26 Nov 2026): 14/14 PASS on real IG DEMO
Needed fix: IG only accepts the market's own currency (USD for EURUSD CFD) — the engine now reads it from IG.
Verified live: order + confirmation, broker stop/limit (12/18 pips exact), duplicate rejection, restart recovery, normal close, kill-switch close.
Observed round-trip cost at size 1: about 0.8 pip (about £6). With a 12-pip stop / 18-pip target the strategy must win roughly 43% of trades just to break even after spread.

## Before pressing Resume
1. Deploy this bundle; verify: `grep -c "rules.currency" ig-exec/src/execution/engine.js` prints 1.
2. Render env: `IG_EXEC_SIZE=1`, `IG_PIP_VALUE_GBP=7.6`, `IG_EXEC_EPICS=CS.D.EURUSD.CFD.IP`.
3. Shell: `cd ig-exec && node scripts/pg-smoke.js` must print `PG SMOKE TEST PASSED` (tests every database call; cleans up after itself).
4. Start the paper simulation in the existing dashboard. It needs 30 consecutive 5-minute bars (about 2.5 hours) after EVERY restart/deploy before it can signal.
5. Press Resume on /ig-exec.html. FX is closed from Friday ~22:00 to Sunday ~22:00 UK time.

## Results report, exact P&L and alerts (added after the first live trade)
**Exact P&L.** Every 5 minutes the engine matches closed trades to IG's own transaction history (instrument + size + open level + open time) and replaces the
estimate with IG's booked figure. The original estimate is kept, so the report can tell you the true `IG_PIP_VALUE_GBP`. Stop-outs are relabelled `BROKER_STOP` / `BROKER_LIMIT`.
Run manually: Results report page -> "Sync exact P&L from IG", or `POST /api/admin/ig-exec/pnl-sync`. If trades stay "estimated", run
`cd ig-exec && node scripts/demo-acceptance.js` (check 13 prints IG's raw transactions) and send me that output.

**Captured per trade:** quote at decision time, spread, slippage, and signal context (score, RSI, EMA9/21, paper spread, signal-to-order delay).

**Report** (`/ig-report.html`, or `GET /api/admin/ig-exec/report`; `trades.csv` for your own analysis): win rate with 95% range vs break-even win rate, average win/loss,
profit factor, expectancy, spread and slippage costs, results by exit type / hour / direction, paper-vs-broker gap, and a plain verdict that stays "too few trades" until n >= 30
and only makes a call at n >= 100.

**Alerts.** Opened, closed (with P&L), kill switch on/off, signal skipped (with reason), IG rejection, unexpected position at IG, engine degraded/recovered, order outcome unknown,
engine started, plus a weekday summary at 21:00 UTC. Setup: generate VAPID keys, set the 4 env vars in `render.env.example`, deploy, open `/ig-exec.html` on your phone
(iPhone: add to Home Screen first), enter PUSH_PAIRING_TOKEN, "Enable alerts on this device", then "Send test IG alert".
Max 30 non-critical alerts/hour. If you stop receiving the daily summary on a weekday, the app is down: check Render.

**Also changed:** the paper engine now carries score/RSI/EMA/spread on each plan (additive only; signals unchanged), `server.js` mounts the existing `/api/push/*` subscription routes
(they were not mounted before), and `public/sw.js` uses a per-message tag so a "closed" alert does not replace an "opened" one.

## Real IG transaction format (captured 27 Nov 2026) and pip value
IG reports `size` with a sign ("+1" = BUY, "-1" = SELL) and names the instrument like "EUR/USD converted at 0.76798". The matcher handles both.
IG booked -£5.38 for a -0.7 pip round trip and -£7.68 for -1.0 pip: **about £7.68 per pip at size 1** (= $10 x the USD->GBP rate IG applied, 0.768). It moves with GBP/USD,
so set `IG_PIP_VALUE_GBP=7.68`; estimates are replaced by IG's exact figures within about 5 minutes anyway.
Observed cost of a round trip at size 1 with a ~1 pip spread: about £5-8.
