# MarketPulse AI v69 — Streaming Reliability and Unattended-Readiness Upgrade

## Scope
Incremental upgrade to your existing v68 IG DEMO app. **Read-only**. This release materially improves the quote-validation defect found in your Render output and adds a separate diagnostic/certification-readiness API. It **does not** place broker orders, certify GBP pip value, or unlock unattended trading.

## Included
- `server.js`: v68 server with a registered v69 readiness observer, preserving older endpoints and broker-write locks.
- `v68-controller.js`: fixes `DLG_FLAG` padding handling both when receiving stream events and checking quote status. It **continues to reject missing `DELAY`**; no fallback to zero or guessed quote certification.
- `v69-readiness.js`: checks quote receipt age, IG 13-digit timestamp plausibility, normalized market flag, spread, delay, journal, cycle and risk blockers. Separates plausible timestamp from *certified* exchange timestamp. Adds a read-only certification matrix.
- `v67-autonomy.js`: included as a compatibility copy from v68.
- `test-v68.js`, `test-v69.js`: local mocked regression tests.

## Install
1. Back up your GitHub project and persistent Render data first.
2. Upload `server.js`, `v68-controller.js`, and `v69-readiness.js` to the root of the existing repository. Do not delete other modules.
3. Commit and redeploy. Keep `BROKER_DEMO_EXECUTION=false`, `V66_ENABLE_SUPERVISED_IG_DEMO=false`, and any existing broker safety controls unchanged.
4. Ensure `DATA_DIR` uses your configured persistent disk. This patch cannot make an ephemeral filesystem persistent.

## Render Shell checks
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v69/status" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v69/quote-diagnostics" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v69/certification-matrix" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v68/status" | python3 -m json.tool
```

## Current blockers
Your real v68 stream had `marketFlag: "DEAL         "` and `delay: null`. This patch fixes the first, not the second. The Mini quote cannot be considered independently undelayed until the IG stream's field schema or another authoritative source confirms delay. The 13-digit timestamp appears plausible but is **not** proven to be an exchange-origin timestamp. v68's 5-minute bar builder still only accepts quotes with explicit `DELAY=0`; it may remain at zero bars.

GBP monetary exposure, an explicitly approved real IG DEMO open/stop/close lifecycle, and recovery from an actual uncertain broker submission remain **uncertified**. The automated cycle is a read-only observation loop, not an unattended trading engine. Risk limits are displayed and checked for the local paper ledger but are not yet independently reconciled with all broker P&L and fills.

## Test locally
```bash
node --check server.js
node --check v68-controller.js
node --check v69-readiness.js
node test-v68.js
node test-v69.js
```
Tests mock broker access and do not validate live IG behaviour.
