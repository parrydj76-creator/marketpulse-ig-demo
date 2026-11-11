# MarketPulse AI v68 — Direct Mini Stream + Scheduled Read-Only Controller

## Installation
This is an **incremental upgrade** based on the v67 `server.js` and `v67-autonomy.js` files previously supplied. Back up the current GitHub repository and persistent DATA_DIR first.

Upload **server.js**, **v68-controller.js** to the repository root. The included **v67-autonomy.js** is a reference copy; do not overwrite a newer existing version unnecessarily. Preserve all other modules, including v66-dealing.js. Redeploy Render. Requires existing `lightstreamer-client-node` dependency and `IG_ACCOUNT_TYPE=DEMO`.

**Do not enable V66_ENABLE_SUPERVISED_IG_DEMO or other broker write flags.** The existing legacy broker gate and v66 preflight remain locked.

## Features
- Dedicated `PRICE:<account>:CS.D.EURUSD.MINI.IP` Lightstreamer subscription with bid/ask, DLG_FLAG, DELAY, and TIMESTAMP fields
- Strict 15-second *local receipt* freshness, non-delayed DEAL flag, and <=2.5-pip spread validation
- No claim that a clock-only IG timestamp proves exchange-side freshness
- 5-minute streamed sample bars and EMA9/EMA21/RSI heuristic, requiring 30 consecutive bars
- Scheduled 60-second read-only evaluation (no broker order writes), broker position check and daily limits
- Hash-linked, fsynced JSONL journal with restart integrity check and reconstructed paper ledger
- Read-only IG contract and GBP account evidence endpoint; **GBP pip sizing remains uncertified**
- Read-only IG broker position/stop inspection; **no real order open/close has been executed or certified**
- Optional isolated simulated unknown-intent restart drill; durable fail-closed unknown state
- Emergency halt, no unattended arm path

## Render Shell
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v68/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/api/v68/cycle" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/api/v68/sizing-evidence" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/api/v68/lifecycle-evidence" | python3 -m json.tool
```

After startup, allow ~30 seconds for the Mini stream connection attempt, and 150+ minutes of genuine sampled 5-minute bars for a fully warmed-up signal. Do not expect a trade from this build.

## Important limitations
1. **No independent GBP pip certification:** `valueOfOnePip`, deal-size mapping and USD/GBP conversion remain unresolved. No asserted FX input can enable execution.
2. **No broker open/close test performed:** A real IG DEMO supervised order requires a separate explicit operator approval and independently verified risk controls. The v66 execution preflight still blocks it.
3. **No end-to-end broker crash certification:** The restart drill proves only the local journal's unknown-intent persistence and fail-closed handling. It does not test broker order submissions.
4. **No autonomous broker orders or paper entries:** The scheduled controller observes market signals and risk, but refuses to open a simulated position without certified GBP risk. Paper close accounting is included for future controlled simulation state.
5. **Timestamp caution:** The subscription TIMESTAMP can be clock-only; 15-second receipt freshness is not equivalent to independently verified market-origin freshness.
6. **Persistent storage is mandatory** for journal health; if DATA_DIR is ephemeral, state can be lost on Render restart.
7. **Emergency halt persists** and has no reset endpoint. The optional drill injects an intentionally unresolved fake intent with no automatic clear path. Run it only on a disposable test instance with `V68_ENABLE_CRASH_DRILL=true`.
8. An IG session reconnect may require POST `/api/v68/stream-reconnect` to refresh the Mini stream.

## Local syntax and unit tests
```bash
node --check server.js
node --check v68-controller.js
node test-v68.js
```
Tests use a stubbed Lightstreamer module and do not connect to IG or place broker orders.
