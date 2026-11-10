# MarketPulse AI v56 — Unattended Shadow/Paper Workbench

**This release does NOT enable unattended IG DEMO trading.** IG dealing writes remain centrally hard-blocked in `server.js` via `v54-safety.js`. It introduces an operator-armed **unattended shadow/paper cycle** with periodic read-only IG account checks, persisted hash-chained evidence, indicative £25 proposal cap, a £100 paper-loss gate and maximum 3 paper opens per UTC day. Operator-supplied FX and paper P/L are not broker-certified.

## Deploy

Back up the GitHub repository. Upload ZIP contents to repository root (no enclosing folder), preserving Render environment variables and persistent disk. Deploy. Do not enable `BROKER_DEMO_EXECUTION` or any legacy broker-write flags. v56 never submits orders regardless of those flags.

## Verify (Render Shell)

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v56/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v56/arm-unattended" | python3 -m json.tool
```

## Optional shadow-only cycle

Operator arms shadow mode for current process only; it is disarmed after every restart. A timer examines queued candidate proposals every 60 seconds and performs **read-only** IG position/account checks. It may record a simulated `PAPER_OPEN`, never an IG order. All paper closes require operator-supplied simulated GBP P/L.

```bash
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v56/arm-shadow" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"clientIntentId":"shadow-demo-0001","epic":"CS.D.EURUSD.MINI.IP","direction":"BUY","size":0.1,"stopPips":12,"usdToGbp":0.75,"pipUsdPerFullSize":1}' "$BASE/api/v56/queue-candidate" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v56/cycle" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v56/stop-shadow" | python3 -m json.tool
```

The candidate inputs above are *illustrative only* and must not be interpreted as verified IG dealing values. `PAPER_OPEN` does not open a DEMO position. The shadow module cannot close existing IG positions. Use IG directly for broker management.

## Remaining for unattended IG DEMO

Independently verify GBP risk and stop/deal-size units, supervised Mini open/close broker lifecycle, unknown submission recovery, atomic multi-instance locks, broker-derived daily P/L and trade counts, execution adapter with fail-closed tests. Certification remains false until demonstrated.
