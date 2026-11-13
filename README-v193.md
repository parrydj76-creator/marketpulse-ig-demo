# MarketPulse AI v193 — Broker-readiness expansion

This is a **read-only, fail-closed** upgrade built on v192. It DOES NOT enable automated IG DEMO orders or certify broker safety.

## New API routes (X-Admin-Token required)
- `GET /api/v193/status` — version and execution block
- `POST /api/v193/snapshot` — GET-only market, positions, account shape diagnostics, persisted as hashed evidence
- `POST /api/v193/history` — version-2 query-parameter transaction pagination, up to 20 pages per seven-day window, duplicate-page detection, durable page digests
- `POST /api/v193/risk` — conservative estimated GBP exposure preview (requires source references; **never certifies** sizing)
- `GET /api/v193/integrity` — hash audit of up to 500 recent records from each of v190, v192, v193
- `GET /api/v193/report` — seven outstanding certifications
- `GET /api/v193/evidence` — evidence index
- `GET /api/v193/evidence/verify/:id` — hash verification
- `POST /api/v193/order/submit` — always HTTP 409; no broker order adapter

## Install
Back up the repository. Upload all archive files to the repository root and redeploy Render. Do not delete the existing database. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. v193 uses the existing v125 PostgreSQL pool and authenticated GET-only IG wrapper. No new environment variables.

## Render Shell smoke tests
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v193/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v193/snapshot" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"from":"2026-11-12","to":"2026-11-13","maxPages":10,"pageSize":100}' "$BASE/api/v193/history" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v193/integrity" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v193/report" | python3 -m json.tool
```

## Remaining gates
No independent certification of GBP pip value, fee-inclusive P&L, exchange timestamp, historical paper accounting, real protective stop lifecycle, unknown-submission recovery, or fencing integrated into broker submission. The `risk` endpoint is an **estimate**, not an authorization. Broker orders are hard blocked regardless of inputs. Do not switch execution on merely because API smoke tests pass.
