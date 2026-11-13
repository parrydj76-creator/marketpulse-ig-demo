# MarketPulse AI v198 — Restart & Fault Safety Mega Upgrade

**No broker writes. No unattended trading. 0/7 independent certifications.**

Adds durable restart probes, full-table canonical evidence integrity audits (up to 100,000 rows), 12 persisted fault scenarios, GET-only IG market/position/account snapshots, v197 readiness integration and an explicitly blocked order endpoint.

## Installation
Back up your GitHub repository, upload these project files, redeploy Render. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. No new dependencies.

## Render shell
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v198/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v198/restart/probe" | python3 -m json.tool
# Save the returned id, restart Render, then:
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v198/evidence/REPLACE_WITH_ID/verify" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v198/broker/snapshot" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"confirm":"SIMULATION_ONLY_NO_ORDER","scenario":"AFTER_SEND_TIMEOUT"}' "$BASE/api/v198/fault/rehearse" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v198/audit" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v198/readiness" | python3 -m json.tool
```

Note: historical v197 audit returned 0 records in the last user test. A separate v197 prepare/transition/restart test is still required; v198 does not pretend that this has been proven. Database digest verification is not an independently tamper-proof audit trail.
