# MarketPulse AI v251–v255 — verification workbench (GET-only)

This is a **flat overlay** for the already deployed v250 project. Upload `server.js` and `v255-verification-workbench.js` to the repository root. Keep `v242-execution-foundation.js`, v241, and all existing dependencies. `test-v255-workbench.js` is optional for local tests.

**Never enable IG broker writes.** `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`. This overlay adds no IG POST/PUT/DELETE calls. `order/submit`, `order/approve`, `trading/arm`, and `trading/auto-start` all return HTTP 409. The original v250 routes are preserved.

## Tests in Render Shell

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
H="X-Admin-Token: $ADMIN_TOKEN"
for e in status readiness audit; do curl -fsS -H "$H" "$BASE/api/v255/$e" | python3 -m json.tool; done
curl -fsS -X POST -H "$H" "$BASE/api/v255/broker/contract" | python3 -m json.tool
curl -fsS -X POST -H "$H" "$BASE/api/v255/broker/freshness" | python3 -m json.tool
```

Risk scenario: inputs are **hypothetical**, not certified. Never treat the calculation as an order recommendation.

```bash
curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d '{"confirm":"ILLUSTRATIVE_ONLY_NO_ORDER","size":0.1,"stopPips":12,"pipValueGBPPerPipPerSize":7.7,"spreadPips":0.9,"commissionGBP":1,"slippageGBP":2,"conversionBufferGBP":1,"dailyRealizedLossGBP":0,"tradesToday":0,"maxRiskGBP":25}' \
 "$BASE/api/v255/risk/scenario" | python3 -m json.tool
```

Operator review, with persistent idempotency and explicit non-authorization:

```bash
KEY="V255_REVIEW_$(date +%s)"
RESPONSE=$(curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d "{\"confirm\":\"REVIEW_ONLY_NO_ORDER\",\"idempotencyKey\":\"$KEY\",\"side\":\"BUY\",\"size\":0.1}" \
 "$BASE/api/v255/review/prepare")
echo "$RESPONSE" | python3 -m json.tool
ID=$(echo "$RESPONSE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d "{\"confirm\":\"RECORD_REVIEW_NO_AUTHORIZATION\",\"reviewId\":\"$ID\",\"note\":\"Reviewed as documentation only; no trade authorization\"}" \
 "$BASE/api/v255/review/record" | python3 -m json.tool
curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d '{"confirm":"FENCE_DRILL_NO_ORDER"}' "$BASE/api/v255/fencing/drill" | python3 -m json.tool
curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d '{"confirm":"SIMULATE_UNKNOWN_NO_ORDER"}' "$BASE/api/v255/recovery/crash-drill" | python3 -m json.tool
curl -fsS -H "$H" "$BASE/api/v255/audit" | python3 -m json.tool
curl -sS -i -X POST -H "$H" "$BASE/api/v255/order/submit"
```

## What this DOES NOT certify

- `quoteCurrency` reports the first IG instrument currency, not necessarily the pair's settlement or guaranteed P/L conversion currency. Verify against account-specific broker documents.
- IG `updateTime` without date and timezone cannot certify freshness. `updateTimeUTC` is only parsed when it is a full timezone-qualified ISO timestamp. A passing field check is still not independent exchange-time certification.
- The risk formula is illustrative. GBP pip value, spread, commission, conversion and slippage are caller inputs and have not been corroborated. Gap risk and stop-fill slippage may exceed modeled buffers.
- Fencing drill increments a database epoch but does not fence real broker writes across workers. Crash drill records a simulated unknown outcome, not actual broker recovery.
- Operator review **never authorizes** a broker order.
- Audit covers **mp_v255 only**; check v250 and earlier audits separately. Record integrity hashes are not tamper-proof against a database administrator who can rewrite both data and hashes.
- All 7 independent certifications remain **0/7**. No supervised broker execution adapter is included.
