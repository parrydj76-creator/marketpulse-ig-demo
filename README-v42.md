# MarketPulse AI v42 — read-only broker verification

This is a complete integrated v41-based project, adding an isolated v42 read-only IG DEMO evidence workbench. It does not submit, modify, or close IG orders. No broker sizing or crash recovery certification is claimed.

## Install
Back up the existing GitHub repository, extract the ZIP, replace the project contents, and redeploy on Render. Preserve DATA_DIR and persistent disk. Keep BROKER_DEMO_EXECUTION=false and AUTO_START=false. Do not copy node_modules or overwrite secrets. v36 paper engine remains restart-disabled and requires explicit manual restart.

## Verify in Render Shell

```
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v42/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v42/observe" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v42/evidence" | python3 -m json.tool
```

Open `/v42` for the dashboard. The observer rate-limits to one request per 10 seconds. Evidence records survive restart on persistent storage; journal hash-chain validation fails closed on tampering. A clean observation does not certify broker sizing or order execution.

## Next gates
Verify contract value per pip and FX conversion independently; test operator-approved IG DEMO order placement, confirmation and closing; then broker-backed uncertain-submission recovery and duplicate suppression. Unattended broker execution stays blocked until independently proven.
