# MarketPulse AI v71 — High-frequency research & unattended readiness

## Scope
This is a large **read-only** improvement towards unattended IG DEMO trading, **not** unattended broker execution. It reuses the existing v68 Lightstreamer Mini feed and v70 evidence collector. The new v71 sampler records qualifying observations every five seconds (instead of v70's one-minute cycle), builds research-only five-minute OHLC bars, and runs broker read-only reconciliation every minute. It does not subscribe to every individual Lightstreamer tick: its five-second observations are samples, not full tick-derived candles.

- Padded `DEAL` market flags are normalized; stale quotes, invalid bid/ask, implausible IG timestamps and wide spreads are rejected.
- Missing IG delay **does not prevent research-only observation**, but **never certifies the feed for execution**.
- A five-minute candle must contain at least 12 samples spanning at least four minutes before it counts towards a 30-bar research warm-up.
- EMA9/EMA21/RSI are research heuristics, not proven predictive models.
- All samples and audit reports are appended to an fsynced SHA256 hash-chain journal. Restart reconstructs research history; corruption fails closed. This is local persistence integrity, **not** broker crash-recovery certification.
- Broker position and GBP account reads are attempted each minute. No real order open/close test is performed.
- GBP risk sizing, Mini delay, supervised lifecycle and broker crash recovery remain uncertified. Broker order callbacks are absent and the arming endpoint rejects requests.

## Installation
1. Back up the existing GitHub repository and Render persistent DATA_DIR.
2. Upload only `server.js` and `v71-engine.js` from this package into your current repository root. Keep all other existing v67–v70 modules, package.json, credentials and environment variables.
3. **Do not enable** any broker write flags (`BROKER_DEMO_EXECUTION`, `V66_ENABLE_SUPERVISED_IG_DEMO`, etc.). `IG_ACCOUNT_TYPE` must remain `DEMO`.
4. Commit and deploy to Render. Ensure DATA_DIR is on persistent disk, with a single writer/instance. Multiple instances sharing the journal are **not supported**.
5. Expect the first research bar after five minutes, and 30 qualified consecutive bars after at least 150 minutes of healthy operation. Restarts can reconstruct existing completed bars.

## Render Shell tests
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v71/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v71/observe" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v71/audit" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v71/candles" | python3 -m json.tool
```

## Important limitations
The existing v70 engine remains active; v71 runs independently. Running both increases disk writes and memory usage. v71 loads its journal into memory on startup and is not yet suitable for unlimited long-term tick retention; rotate/archive only with an integrity-preserving procedure. `journalHealthy` does not independently prove Render persistent disk is configured. The research signal does not execute paper or broker trades, and risk limits are not independently certified against IG transactions. Never interpret an API 200 as authorization to deal.

## Local verification
`node --check server.js && node --check v71-engine.js && node test-v71.js`
