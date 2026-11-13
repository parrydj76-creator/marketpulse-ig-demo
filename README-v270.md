# MarketPulse AI v256–v270: Unattended SHADOW readiness mega-upgrade

## Scope and safety

A flat GitHub overlay on v255: replace `server.js` and add `v270-unattended-readiness.js`. Retain existing modules and dependencies. Optional `test-v270.js` runs with `node test-v270.js`. This adds **NO broker write calls** and does **NOT** start an unattended broker trading loop. It is a stepping stone toward unattended IG DEMO trading, not an implementation of broker execution.

Set Render environment `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. Ensure the existing server's legacy broker execution gates remain disabled; v270's `brokerOrderAllowed:false` only governs its own routes. Do not set `DEMO_EXECUTION_TESTED=true` or enable any old broker-write path.

## Features

- Authenticated IG market preflight with fail-closed quote freshness (requires timezone-qualified UTC), delay, spread, dealing minimum and deal increment; missing fields are not inferred.
- Stress scenarios with caller-supplied GBP pip value and fees, 0/2/5/10/25 extra gap pips; **illustrative** only, never certified maximum loss.
- Persistent idempotent **quarantined** shadow intents; operator rejection with row lock and payload digest; no execution or broker side effects.
- PostgreSQL lease epoch drill with stale epoch check and release; **does not** certify distributed broker-write fencing or crash recovery.
- Unknown outcome simulation with explicit `brokerRequestSent:false`.
- Read-only readiness and audit endpoints. All seven independent certifications remain 0/7.

## Render Shell smoke tests

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
H="X-Admin-Token: $ADMIN_TOKEN"
for e in status readiness audit; do curl -fsS -H "$H" "$BASE/api/v270/$e" | python3 -m json.tool; done
curl -fsS -X POST -H "$H" "$BASE/api/v270/market/check" | python3 -m json.tool
curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d '{"confirm":"SHADOW_STRESS_NO_ORDER","size":0.1,"stopPips":12,"pipValueGBPPerPipPerSize":7.7,"spreadPips":0.9,"commissionGBP":0,"slippageGBP":1,"conversionBufferGBP":1,"dailyLossGBP":0,"tradesToday":0,"openPositions":0}' \
 "$BASE/api/v270/risk/stress" | python3 -m json.tool
KEY="MP270_SHADOW_$(date +%s)"
RESPONSE=$(curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d "{\"confirm\":\"SHADOW_ONLY_NO_ORDER\",\"key\":\"$KEY\",\"side\":\"BUY\",\"size\":0.1}" "$BASE/api/v270/shadow/prepare")
echo "$RESPONSE" | python3 -m json.tool
ID=$(echo "$RESPONSE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d "{\"confirm\":\"REJECT_SHADOW_NO_ORDER\",\"id\":\"$ID\"}" "$BASE/api/v270/shadow/reject" | python3 -m json.tool
curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d '{"confirm":"DB_LEASE_DRILL_NO_ORDER"}' "$BASE/api/v270/fencing/lease-drill" | python3 -m json.tool
curl -fsS -X POST -H "$H" -H 'Content-Type: application/json' \
 -d '{"confirm":"UNKNOWN_OUTCOME_SHADOW_ONLY"}' "$BASE/api/v270/recovery/unknown-drill" | python3 -m json.tool
curl -fsS -H "$H" "$BASE/api/v270/audit" | python3 -m json.tool
curl -sS -i -X POST -H "$H" "$BASE/api/v270/order/submit"
```

## Important limitations

1. `readyForUnattendedShadow` means only that the v270 audit is valid, not that a scheduled shadow trading process is running. There is no automated shadow order generation in this overlay.
2. An IG clock-only `updateTime` is not proof of freshness. Do not patch it to accept receipt time as exchange time.
3. Risk uses caller-supplied pip value and fees; no broker reconciliation or independently certified GBP value. Even with stops, losses can exceed a nominal £25 budget.
4. The database lease drill is a simulation. It does not protect any existing IG broker write code, and it does not exercise multiple worker processes.
5. The digest protects against accidental mutation only; a privileged database user could rewrite data and digest. Audit is scoped to `mp_v270_ONLY`.
6. Operator rejection cannot authorize a trade; shadow intents remain quarantined unless explicitly rejected.
7. Controlled IG DEMO order lifecycle testing, guaranteed stop terms, fee and conversion reconciliation, multi-worker execution fencing, crash-safe unknown broker outcome recovery, and independent accounting evidence are outstanding. **0/7 certifications**.

## Before any real unattended DEMO trading

Require independently verified contract/GBP pip math, costs and deal-size increments; reliable broker timestamp evidence; robust net realized/unrealized daily accounting; multi-process lease with broker-side idempotency and fail-closed restart; tested reconciliation of ambiguous order outcomes; verified broker stop lifecycle; emergency kill switch and human approval for first supervised demo trades. Keep the broker-write adapter absent until those gates pass.
