# MarketPulse AI v111–v115 Combined Certification Workbench

**Read-only, fail-closed. No IG dealing calls added. No certification granted.**

## Included
- v111: Admin-triggered combined IG read-only refresh via the working v95 capture (market, positions, accounts, daily history). No automatic polling or API load.
- v112: Independent contract and GBP sizing evidence checks; values must be independently verified. Never automatically certified.
- v113: Daily accounting reconciliation diagnostics including fees, cash flows, GBP account and UK date boundary flags. No unsupported net-P&L certification.
- v114: **Optional PostgreSQL advisory-lock workbench** with acquire/release test, not integrated with trading execution. Requires `pg` installed and `V115_DATABASE_URL`; this is NOT a production order lock or distributed single-writer certification.
- v115: Hash-linked audit evidence, safety tests and explicit blocked arm route.

## Install
1. Back up your GitHub repo and persistent Render disk. Keep all existing journals.
2. Upload **all runtime .js files** in this ZIP into your repo root; replace matching names, preserving other repo files.
3. Commit and deploy. No database configuration is needed for normal read-only tests.
4. For optional PostgreSQL lease testing, install `pg` in your existing package (`npm install pg --save`) and set `V115_DATABASE_URL` to a secure database connection URL. For TLS use your provider's documented SSL settings; `V115_PG_SSL=true` enables certificate verification (CA must be trusted). Never paste credentials into chat.
5. `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false` remain hard-coded. Do not alter.

## Render Shell verification
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for p in status diagnostics fault-tests lease; do
  echo "==== $p ===="
  curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v115/$p" | python3 -m json.tool
done
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v115/refresh" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v115/evidence/capture" | python3 -m json.tool
# Optional, only when V115_DATABASE_URL is configured:
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v115/lease/test" | python3 -m json.tool
```

## Remaining blockers
- Undelayed timestamped streaming prices (snapshot recency is not feed-delay certification).
- Independently verified IG mini-contract GBP pip value, size increments and FX conversion.
- Reconciled broker net daily P&L including fees and cash flows; zero transactions cannot certify this.
- Actual protective-stop lifecycle and unknown-submit/restart recovery evidence.
- Production-grade distributed lease and durable order-intent state machine (workbench lock is not connected to order submission).
- Quarantined historical paper accounting and independent readiness review.

**Do not enable broker execution.**
