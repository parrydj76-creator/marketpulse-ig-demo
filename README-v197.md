# MarketPulse AI v197 — Operator Lifecycle & Recovery Mega Upgrade

**This release does NOT enable unattended or operator-initiated IG broker order submission.** All `/api/v197` routes require `X-Admin-Token`. Existing legacy code may have other execution controls; ensure `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false` in Render.

## Major additions
- Durable PostgreSQL intent state machine: `PREPARED`, `UNKNOWN`, `RECONCILIATION_REQUIRED`, `REVIEWED`, `CANCELLED`.
- PostgreSQL transaction advisory lock and monotonic fence for **preparation and state transitions only**; not a distributed broker execution lock.
- No automatic retries for unknown outcomes; operator review is mandatory.
- Read-only IG positions/accounts reconciliation; absence of positions is **not** proof of no submission.
- Canonical SHA-256 verification of all v197 intent and event records, bounded to 100,000 rows, plus existing v196 checks.
- Readiness gate excludes stale `AUDIT_SAMPLE_NOT_FULL_HISTORY` from v195 while retaining explicit real certification blockers.
- Explicit blocked `/api/v197/order/submit` endpoint.

## Deployment
Back up your existing repository. Upload all files from this ZIP into GitHub repo root, commit and redeploy Render. Do not overwrite environment secrets. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`.

## Smoke tests in Render Shell
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v197/status" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v197/audit" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v197/readiness" | python3 -m json.tool
```

## Optional safe operator-intent rehearsal
```bash
# Supply a fresh unique operatorNonce (>=16 characters) and a meaningful note.
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
 -d '{"confirm":"PREPARE_ONLY_NO_ORDER","epic":"CS.D.EURUSD.MINI.IP","direction":"BUY","operatorNonce":"unique-rehearsal-2026-11-13-a","note":"Rehearsal only; no order will be sent"}' \
 "$BASE/api/v197/intent/prepare" | python3 -m json.tool
# An intent remains unresolved until explicitly cancelled/reviewed. Use returned ID:
# curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
# -d '{"state":"CANCELLED","confirm":"OPERATOR_REVIEW_NO_ORDER"}' "$BASE/api/v197/intent/<ID>/transition"
```

## Certification limitations
0/7 independent certifications. No GBP Mini deal-size certification, complete financial reconciliation, exchange time validation, real protective stop test, real crash recovery test or broker-integrated distributed fencing. This is a **substantial architecture step**, not unattended execution. No software can guarantee profitability or eliminate CFD loss.
