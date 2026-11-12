# MarketPulse AI v151–v160: Rehearsal Locking & Broker Evidence Review

## Safety boundary
This is a **READ_ONLY_FAIL_CLOSED** release. It does not place IG orders, arm execution, or certify any broker safeguards. It does not integrate its rehearsal lease into a broker order path. Never turn on unattended trading on the strength of these tests.

## Installation
Based on the v150 package. Back up your current server.js and compare with your deployed copy before replacing. Upload updated server.js and new v160-execution-readiness.js; retain all previous .js files, public assets, environment variables, PostgreSQL connection and data. Keep BROKER_DEMO_EXECUTION=false, AUTO_START=false and V125_READONLY_POLL_MS=60000.

## Routes (all require X-Admin-Token)
- GET /api/v160/status — policy and readiness, no certification
- GET /api/v160/fault-tests — local fail-closed tests
- POST /api/v160/lease/rehearsal — real PostgreSQL lease competition, fencing and stale-owner rejection (REHEARSAL ONLY)
- POST /api/v160/risk/evidence-review — candidate risk calculator; supplied values and attestations are NOT independent verification
- POST /api/v160/lifecycle/scenario — pure simulation of lifecycle event list, never calls IG
- POST /api/v160/arm — always HTTP 409

## Render Shell checks
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
for route in status fault-tests; do
 curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v160/$route" | python3 -m json.tool
done
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v160/lease/rehearsal" | python3 -m json.tool
```

### Risk review example — hypothetical figures ONLY, not real IG contract values
```sh
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
 -d '{"epic":"CS.D.EURUSD.MINI.IP","brokerEpic":"CS.D.EURUSD.MINI.IP","accountCurrency":"GBP","quoteCurrency":"USD","size":0.1,"minimumSize":0.1,"sizeStep":0.1,"usdPerPipPerUnit":1,"gbpPerUsd":0.8,"stopPips":12,"spreadPips":1,"signalScore":80,"tradesToday":0,"dailyLossGBP":0,"openPositions":0,"estimatedFeesGBP":0,"contractEvidenceReviewed":false,"fxEvidenceReviewed":false}' \
 "$BASE/api/v160/risk/evidence-review" | python3 -m json.tool
```
Never treat the example numbers as IG contract specifications. Do not send sensitive account identifiers in requests.

### Lifecycle scenario example (simulation only)
```sh
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
 -d '{"epic":"CS.D.EURUSD.MINI.IP","events":["INTENT_PERSISTED","SUBMISSION_UNKNOWN","AUTO_RETRY"]}' \
 "$BASE/api/v160/lifecycle/scenario" | python3 -m json.tool
```

## Limitations and remaining work
- Lease is DB backed and fencing tokens are monotonic; but broker writes do not consume or enforce them. No cross-instance execution safety is certified.
- Rehearsal lease endpoint performs a sequential competing-owner test on the database. Concurrent stress, restart and lease-loss tests still required.
- Broker GBP pip value, deal increment, FX quote source and charges are NOT independently verified.
- Risk evidence flags supplied by an operator are not a substitute for broker documentation.
- Scenario event names are not real IG confirmations or protective stops.
- Outstanding certifications remain 0/7. Broker execution stays HARD_BLOCKED.
