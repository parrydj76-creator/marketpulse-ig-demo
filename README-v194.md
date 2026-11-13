# MarketPulse AI v194 — Execution Safety Lab

**Scope:** Broker-readiness infrastructure, not unattended trading. This release preserves v193 and adds a PostgreSQL-backed operator rehearsal and read-only IG DEMO confirmation/position inspection.

## Safety boundaries

- No IG POST/PUT/DELETE capability is passed to v194.
- `/api/v194/order/submit` returns HTTP 409 unconditionally.
- `BROKER_DEMO_EXECUTION` and `AUTO_START` remain hardcoded `false` in `server.js`.
- No independent broker certifications are asserted; **0/7 passed**.
- `PREPARED` can only be cancelled through the rehearsal transition endpoint. Broker-related states cannot be marked as passed using a manual rehearsal request.
- Database transaction/advisory lock and monotonic fence protect **preparation**, not real broker submission. This does not prove distributed execution safety or exactly-once dealing.
- Read-only confirmation lookup can support later evidence review but does not certify the stop lifecycle or unknown submission recovery.

## Render Shell smoke tests

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v194/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v194/broker/read" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v194/audit" | python3 -m json.tool
```

## Rehearsal intent (no order)

Generate a fresh UUID with `python3 -c 'import uuid;print(uuid.uuid4())'`, then send:

```json
{"confirm":"PREPARE_REHEARSAL_ONLY","epic":"CS.D.EURUSD.MINI.IP","direction":"BUY","operatorNonce":"<UUID>"}
```

POST to `/api/v194/intent/prepare`. The returned ID and fence may be used with POST `/api/v194/intent/transition` and JSON `{ "confirm":"RECORD_REHEARSAL_TRANSITION", "id":"<ID>","fence":"<FENCE>","to":"CANCELLED" }`. Do not leave unresolved rehearsal intents.

## Remaining certification work

Independent contract and GBP pip value verification, transaction/fee reconciliation, exchange-time proof, historical paper accounting, broker-backed stop and close, unknown-submit restart recovery, and actual broker-path fencing. Do not turn on execution flags or assume a simulated rehearsal certifies any of these.
