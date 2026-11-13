# MarketPulse AI v228–v234 — Broker evidence mega upgrade

Flat GitHub upload. **NO BROKER ORDERS**. This release advances evidence collection and safeguards, not unattended trading eligibility.

## Changes
- v228: Read-only IG market, position and GBP account facts
- v229: Bounded IG transaction history diagnostics (max 7 days, 10 pages, page size 100)
- v230: Transaction duplicate detection and explicit accounting incompleteness flags
- v231: GBP risk preview reusing v227 policy checks; input pip/fee figures remain unverified claims
- v232: Durable quarantine record for ambiguous order incidents, no resubmission
- v233: Canonical SHA-256 full-history audit of new evidence table, capped at 100k rows
- v234: Cross-version readiness, 0/7 certifications, explicit hard-blocked broker routes

## Deploy
Back up repository, upload ZIP contents at GitHub repository root, commit and redeploy Render. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. Review all legacy order routes separately; new module's hard blocks do not guarantee old routes are disabled.

## Render shell
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
for endpoint in status readiness audit; do
  curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v234/$endpoint" | python3 -m json.tool
done
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v234/broker/snapshot" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"confirm":"READ_ONLY_HISTORY","from":"2026-11-12","to":"2026-11-13"}' "$BASE/api/v234/history/diagnostic" | python3 -m json.tool
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v234/audit" | python3 -m json.tool
curl -sS -i -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v234/order/submit"
```

## Limitations
- Transaction API pagination can appear complete while accounting is incomplete. No fills/fees/overnight funding certification is inferred.
- Raw broker `updateTime` is not a certified exchange timestamp.
- Never assume IG's `valueOfOnePip` has GBP units without account-specific evidence.
- A quarantined incident is never automatically resubmitted.
- There is no IG broker-write adapter. Real stop lifecycle, crash recovery and distributed broker fencing remain unverified. All 7 certifications remain false.
- Before any operator-approved minimum-size DEMO trade: independently verify GBP pip/size/fees, implement and review broker-integrated fenced submission with protective stop and crash-safe reconciliation, then supervise a broker-confirmed open/stop/close test.
