# MarketPulse AI v39 — Lifecycle monitoring and IG DEMO dry-run workbench

Integrated into server.js. Replaces no existing broker execution system. **No IG order writes in v39.** Keep `BROKER_DEMO_EXECUTION=false` and legacy auto-start disabled. Verify Render environment and other legacy execution routes independently.

## New features
- V36 last-cycle heartbeat and cycle count, without changing entry/exit behaviour or the existing ledger format.
- `/api/v39/status`: heartbeat, verified-feed check, paper position age, 24-hour maximum-hold **review alert**, indicative P/L and remaining broker certification gates.
- `/api/v39/dry-run` (POST): records a non-executing operator dry-run intent to a fsynced, hash-chained journal on the persistent disk. Does not contact IG.
- `/api/v39/intents`: recent dry-run history.
- `/v39`: admin-protected responsive dashboard.

## Deploy
Upload the contents of `marketpulse-ig-demo-main` to your GitHub repo and deploy on Render. Preserve `/var/data` and existing environment variables. Check `BROKER_DEMO_EXECUTION=false`. Restart disables v36; only re-enable after confirming status and healthy feed.

```bash
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v39/status" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v36/status" | python3 -m json.tool
```

## Optional dry-run (no order placed)
```bash
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' --data '{"kind":"DEMO_ORDER_DRY_RUN","epic":"CS.D.EURUSD.CFD.IP","direction":"LONG","operatorNote":"Operator review of simulated intent"}' "http://127.0.0.1:${PORT:-10000}/api/v39/dry-run" | python3 -m json.tool
```

## Limits
- The 24-hour holding threshold only creates an alert. It does not force a closure or modify the v36 trading strategy.
- A v36 open position still requires valid fresh market data to close. No market-data outage protection at the broker is proven.
- Risk sizing uses illustrative GBP pip values; no broker contract, order lifecycle or crash recovery certification is claimed.
- In-process timers are not a substitute for external uptime monitoring.
