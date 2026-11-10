# MarketPulse AI v67 — autonomy rehearsal (IG DEMO, NO BROKER WRITES)

## Install

1. Back up the GitHub repository and persistent `DATA_DIR` (including the v66 journal).
2. Upload `server.js` and `v67-autonomy.js` to the repository root, alongside the existing `v66-dealing.js` and `package.json`. **Do not delete the older modules.**
3. Commit and deploy the latest commit in Render. Keep IG_ACCOUNT_TYPE=DEMO. Do not enable V66 broker write flags.
4. Verify using the commands below. The v67 module has no broker submission functions and cannot arm unattended dealing.

## Render Shell verification

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v67/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"direction":"BUY","score":75,"size":0.1,"stopPips":12,"targetPips":18,"usdPerPipPerSize":10,"usdToGbp":0.75}' "$BASE/api/v67/evaluate" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"scenario":"unknownSubmission"}' "$BASE/api/v67/drill" | python3 -m json.tool
```

The `usdPerPipPerSize` and `usdToGbp` fields are **illustrative, not certified market values**. The evaluation never places an order.

## Included capabilities

- Live, read-only IG Mini REST market and account/position retrieval on evaluation
- Spread, market state, delay and timestamp checks (rejects clock-only updateTime)
- Indicative GBP stop-risk calculator, 25% buffer and hard £25 illustrative limit
- Score/direction rehearsal with fail-closed broker decisions
- Hash-chained, fsynced persistent JSONL audit journal with restart integrity check
- Seven simulated failure drills, read-only status and emergency halt
- Authenticated API endpoints; hard-blocked unattended arming

## Important limitations

- v67 is **not** an unattended execution engine. No scheduled automatic evaluation or broker write is introduced. Trigger `/evaluate` explicitly to rehearse a cycle.
- The seven drills test rule outputs only; they are **not** end-to-end broker, persistence-failure or crash-recovery certifications.
- REST snapshot receipt time is not proof of an exchange-fresh quote. A clock-only `updateTime` is rejected.
- IG's `valueOfOnePip` field and `minDealSize` units remain unverified for order sizing. User-supplied USD/GBP is never treated as a verified FX feed.
- A hash chain detects accidental corruption but is not tamper-proof against a party who can rewrite the journal.
- The v66 supervised dealing adapter remains blocked. No certification flags are changed.

## Next certification milestones

1. Direct Mini streaming quote with independently verified delay and source timestamps.
2. IG contract-unit and GBP pip value validation, plus a fresh verified FX conversion feed.
3. Durable order-intent reconciliation and actual broker stop attachment verification on a single operator-approved DEMO order.
4. Crash/restart tests, duplicate submission prevention, daily-loss accounting from broker transactions and operator emergency stop.
5. Only after all tests: separate explicit opt-in for unattended DEMO trading.
