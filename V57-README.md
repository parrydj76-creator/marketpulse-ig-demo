# MarketPulse AI v57 — automatic signal-driven paper mode

**NO IG DEALING ORDERS.** All IG broker execution remains HARD_BLOCKED. This is a paper simulator, not verified execution or broker-grade risk sizing.

## Changes
- Signal-driven entries from existing EUR/USD CFD 5-minute RSI/EMA analysis, using only a fresh non-delayed STREAM quote, DEAL flag, 30 bars, score >=70 and spread <=2.5 pips.
- Simulated bid/ask entry and exit, 12-pip stop, 18-pip target, 0.1 nominal size; hypothetical GBP P/L using an operator-supplied *indicative* USD/GBP conversion.
- Max 3 paper opens per UTC day, max £100 cumulative paper losses per UTC day, <=£25 indicative risk per trade, one paper position at a time.
- Persistent SHA-256 linked journal, automatic restart disarm, no automatic closing on restart until manually rearmed. Duplicate signals by direction and bar are suppressed across restarts.
- Read-only GBP account and EUR/USD Mini position checks on each eligible cycle. Broker readback errors halt/disarm timer.

## IMPORTANT LIMITATIONS
- Existing signal and quote feed are for `CS.D.EURUSD.CFD.IP`, not `CS.D.EURUSD.MINI.IP`. Price levels are **proxy only**; cannot be used for Mini deal verification.
- Configure `V57_INDICATIVE_USD_TO_GBP` in Render environment with a recent independently verified USD-to-GBP rate (example `0.75` is illustrative, not live). No trades are opened without this setting.
- Existing v56 journal is preserved separately. Do not delete the Render disk or data directory.
- Open paper trades survive restart; automatic mode is disarmed and must be explicitly rearmed. v57 arm intentionally refuses while an open paper position exists: operators should inspect it; no automatic recovery of open positions has been certified.
- Simulated stop/target exits use the first observed bid/ask quote beyond a level; intrabar gaps, missed ticks and costs are not broker-verified. Trading metrics are hypothetical.
- `emergency-stop` is permanent for the v57 journal and requires offline operator intervention to reset; it does not close an IG position.
- Old v56 endpoints remain independently accessible; do not arm both v56 and v57 simultaneously.

## Deploy
Upload the contents of this ZIP into the existing GitHub repository root (replace same-name files; keep Render env and persistent disk). Deploy on Render.

## Render Shell checks
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v57/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/api/v57/arm-paper" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/api/v57/cycle" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/api/v57/stop-paper" | python3 -m json.tool
```
`/api/v57/arm-unattended` always rejects. A manual `cycle` can return `SKIP`, `WAIT`, `HOLD`, `OPEN`, or `CLOSE`; these are paper-only.
