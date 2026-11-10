# MarketPulse AI v53 — IG DEMO Mini evidence matching

## Scope
- Uses working v52 transaction history URL (IG API v2, first page of seven days).
- Adds `/api/v53/transactions`, `/api/v53/deal-confirmation`, `/api/v53/match-evidence`, `/api/v53/reconcile-after-restart`, `/api/v53/inspect`, `/api/v53/monitor`, `/api/v53/status`, `/api/v53/events`.
- Matches exact deal IDs or transaction references only. Text containing EUR/USD is NOT evidence of Mini instrument identity.
- Validates broker account identity across readbacks; persists a hash-linked evidence journal to configured persistent storage.
- All evidence remains uncertified until independent Mini contract, GBP conversion, opening/closing and restart verification.
- No new broker write adapter. `/api/v53/arm-unattended` always rejects requests.

## Deploy
Extract ZIP into existing GitHub repository, commit and deploy latest commit to Render. Preserve existing environment settings and persistent disk. Do not upload credentials. Keep `ENABLE_IG_DEMO_ORDERS=false` and `MP_V65_DEMO_EXECUTION=false` (or unset). Legacy `openDemo` is also hard-blocked in this source.

## Render Shell verification
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v53/status" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v53/inspect" | python3 -m json.tool
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v53/transactions" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v53/monitor" | python3 -m json.tool
```
To fetch an IG confirmation, supply a real **deal reference** (not a transaction reference unless IG confirms they are the same):
```sh
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"dealReference":"REPLACE_WITH_REAL_IG_REFERENCE"}' "$BASE/api/v53/deal-confirmation"
```
To correlate evidence after both broker history and a confirmation have been retrieved:
```sh
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"dealId":"REPLACE_WITH_REAL_IG_DEAL_ID"}' "$BASE/api/v53/match-evidence"
```
`candidate:true` is **not** a certified lifecycle. Matching may require more transaction metadata and explicit close evidence.

## Critical limitations
- No unattended broker order submission. Only manual, operator-executed DEMO trades outside the bot should be used to gather lifecycle evidence, with informed review of the risks.
- v53 `monitor` is a manual read-only endpoint, not a scheduled unattended trading loop.
- The v52 risk calculator is preserved. Independently sourced FX rate and point/size increments are not yet certified.
- The restart endpoint only checks known positions observed in a previous boot. Unknown in-flight orders remain uncertified.
- The v53 journal uses hashes for integrity checks, not authenticated tamper-proof storage.
- Do not assume the broker's history reference is the same as an IG deal reference.
