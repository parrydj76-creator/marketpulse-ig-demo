# MarketPulse AI v85 — Direct GitHub Upload

This package is based on the user's supplied current `server.js` (v84 integrated) and the supplied `v81-simulator.js` source. The two files are already patched and named exactly as required. **No installer or renaming is needed.**

## Files to upload to the ROOT of the existing GitHub repository
- `server.js` — replacement for existing server, preserving v81–v84 integrations and registering `/api/v85/*` before the catch-all route.
- `v81-simulator.js` — replacement simulator with persistent fail-closed safety hold, guarded quote exits and corrected daily trade counting.
- `v85-integrity.js` — new dependency; validates and quarantines invalid historical paper exits without modifying the existing journal.

`test-v85.js` and `test-v85-integration.js` are optional offline tests; they do not need to be deployed. `README.md` is informational.

## Before deployment
1. Back up your GitHub project and the Render persistent `DATA_DIR`, especially `v81-paper-journal.jsonl`.
2. Upload/replace the THREE production JS files above **together in one GitHub commit**. Preserve all other project files and dependencies.
3. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`; v85 does not certify IG broker execution.
4. Redeploy Render and check the new routes.

## Render checks
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v85/status" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v81/status" | python3 -m json.tool
```
The v85 status should report `control.paused: true` by default, with invalid zero-price trades quarantined, and `brokerOrderAllowed: false`. The v81 scheduler may still say `scheduled: true`, but its ticks are blocked by the persistent pause. Do not manually call `/api/v81/tick` or `/api/v85/resume` while investigating historical errors. Existing paper positions remain open/frozen during pause. A paused simulator does not monitor simulated stop prices.

## Offline tests
```sh
node --check server.js
node --check v81-simulator.js
node test-v85.js
node test-v85-integration.js
```

## Known limitations
- v85 quarantines invalid trades from **validated** P&L but does not erase or rewrite original immutable journal entries; old `latestClosed` may still show raw invalid entries for audit.
- P&L is simulated, uses an uncertified GBP/pip assumption, and excludes fees, slippage, gaps and financing.
- Resuming paper simulation is not recommended until operator verification; the v85 pause endpoint is `/api/v85/pause` and guarded resume is `/api/v85/resume`.
- The v84 guardian is read-only and does not pause the v81 scheduler.
- IG quote delay, GBP pip sizing, daily net broker P&L, stop lifecycle and unknown-submit recovery remain uncertified. IG broker orders stay blocked.
- This ZIP contains only changed/new files; it is not a complete repository. It depends on the user's existing modules.
