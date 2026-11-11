# MarketPulse AI v86 — Mega Safety & Readiness Upgrade

## Upload directly to GitHub

This package is based on the exact v85 GitHub-ready server and simulator files previously supplied. **Back up your repository and persistent Render disk before deploying.** Upload `server.js`, `v81-simulator.js`, `v85-integrity.js`, and `v86-readiness.js` to the existing repository root. Keep all other modules and `public/` assets in place. Commit and redeploy Render. Do not upload the ZIP itself to Render.

## What changed

- Removed the automatic `v81Simulator.start()` invocation from active `server.js` so the background paper timer is **not scheduled** on startup.
- Preserved the v85 fail-closed persistent pause and immutable hash-linked journal.
- Replaced the misleading legacy `lastDecision.simulatedDailyPnlGBP` display with the v85 validated paper P&L and marked it `legacyDecisionPnlUntrusted`. Original journal records remain unchanged.
- Added `/api/v86/status` and `/api/v86/readiness` (admin token required): explicit diagnostic gate matrix for feed quality, broker accounting, contract risk, protective stops, recovery, and concurrency.
- `/api/v86/arm` always returns HTTP 409; broker order execution and auto-start remain hard blocked.
- Tests: `node test-v85.js`, `node test-v85-integration.js`, `node test-v86.js` (the v85 integration test may require its existing arguments; see source).

## Verify in Render Shell

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v86/status" | python3 -m json.tool
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v85/status" | python3 -m json.tool
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v81/status" | python3 -m json.tool
```

Expect `paperPaused:true`, `paperSchedulerRunning:false`, `brokerOrderAllowed:false`, `readyForUnattendedDemo:false`, `journalRecords:205` if your journal remains unchanged, and three quarantined historical trades. The v81 `latestClosed` list still contains original bad records for audit; **do not treat those raw P&L values as valid**. The corrected v81 `lastDecision.simulatedDailyPnlGBP` excludes invalid trades for the recorded UK day, but is not certified broker P&L; rely on v85/v86 validated totals.

## Important limits

This is a diagnostic safety upgrade **towards** unattended IG DEMO trading, not an automated broker execution release. No real or demo broker orders are enabled. The v85 `/api/v85/resume` route still exists and can remove the pause after its checks; do not call it until the simulator and broker data have been independently verified. Even after resuming, this release does not start the background simulator. No broker feed delay, exchange timestamps, GBP pip value, fees, stop orders, unknown-submit reconciliation or crash recovery are certified here. Do not change `BROKER_DEMO_EXECUTION=false` or `AUTO_START=false`.
