# MarketPulse AI v214–v220: Broker-Execution Preflight Mega Upgrade

**No unattended or supervised broker API writes are enabled.** This release brings durable preflight evidence, fail-closed checks, read-only IG reconciliation and an unknown-outcome recovery rehearsal into the same flat GitHub upload package as v213. The server still has broker write restrictions. It does NOT certify the seven independent requirements or place real IG DEMO orders. No automated trading should be enabled based on these tests.

## Included milestones
- **v214:** policy-based GBP risk preflight (GBP £25/trade, £100/day, 3 trades/day, 1 position, 12-pip stop, max 2.5-pip spread, 15-second quote age).
- **v215:** independently sourced contract, fee, increment and timestamp evidence *required as inputs*; supplied booleans/references are not independently verified by the software.
- **v216:** read-only IG market/positions/accounts snapshot and durable digest.
- **v217:** PostgreSQL persistent intent ledger and simulated UNKNOWN outcome; no IG submission.
- **v218:** read-only reconciliation for UNKNOWN rehearsal, always transitions to MANUAL_REVIEW, never retries an order.
- **v219:** bounded full-history canonical digest audit for v220 evidence and restart verification by evidence ID.
- **v220:** consolidated readiness with 0/7 independent certifications, hard-blocked arm/submit routes.

## Installation
Back up your GitHub repository. Extract this ZIP: it has **no parent folder**, and the existing project files (including `server.js`) are at the ZIP root. Upload the contents to the same repository directory. Commit and deploy Render. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`; do not alter existing write blocks. Do not paste admin tokens, API keys or account identifiers into chat.

## Render checks
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for endpoint in status readiness audit; do
  curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v220/$endpoint" | python3 -m json.tool
done
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v220/broker/reconcile" | python3 -m json.tool
```

## Durable preflight (illustrative values only, NOT verified GBP/pip)
```bash
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"confirm":"PREFLIGHT_ONLY_NO_ORDER","epic":"CS.D.EURUSD.MINI.IP","currency":"GBP","direction":"BUY","size":0.1,"gbpPerPipPerUnit":1,"stopPips":12,"spreadPips":1,"slippagePips":2,"roundTripFeesGBP":1,"todayNetLossGBP":0,"contractIndependentlyVerified":false,"feesIndependentlyVerified":false,"dealSizeIndependentlyVerified":false,"quoteAgeMs":20000,"exchangeTimestampVerified":false,"activePositions":0,"tradesToday":0}' \
  "$BASE/api/v220/preflight" | python3 -m json.tool
```
This example must be `candidateValid:false` and `brokerOrderAllowed:false`. Even a `candidateValid:true` proposal is NOT authorised to trade. The sample pip value is intentionally unverified; do not use it for order sizing.

## Simulated unknown-submission recovery and persistence
```bash
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"confirm":"SIMULATE_UNKNOWN_NO_ORDER"}' "$BASE/api/v220/recovery/simulate-unknown" | python3 -m json.tool
```
Save the returned ID. Restart Render and use:
```bash
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"confirm":"REVIEW_ONLY_NO_ORDER","id":"REPLACE_WITH_INTENT_ID"}' "$BASE/api/v220/recovery/review" | python3 -m json.tool
```
This moves the simulated intent to `MANUAL_REVIEW` after read-only IG checks; it does not clear the intent, certify recovery, or place/retry an order. Rehearsal is limited to one unresolved intent; repeat simulations are blocked until independent manual resolution (not exposed by this module).

## Actual route to unattended IG DEMO
The independent evidence still required includes historical fills/fees, exchange timestamp and delay, independently verified GBP pip value and size increments, net daily P/L, broker-confirmed protective stop lifecycle, actual unknown-submission recovery, and PostgreSQL fencing integrated with the real submission path. A real broker write adapter, supervised operator test, kill switch, reconciliation and signoff must be independently validated before unattended mode. This package does **not** include such an adapter, and does not claim readiness. Check `/api/v220/readiness` for the remaining blockers.
