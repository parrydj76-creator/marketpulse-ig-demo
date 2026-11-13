# MarketPulse AI v204 — v198/v203 route-order hotfix

This package includes the full v203 project and fixes a confirmed Express route ordering bug. In the previous release, v198 and v203 route registrations were below `app.get('*', ...)`, which intercepted their GET requests and returned the legacy HTML dashboard (HTTP 200). POST routes were not intercepted.

## Changes
- Moved the existing v198 and v203 module creation, `routes(app)` calls and `init()` calls immediately before the existing catch-all GET route.
- Preserved module dependency order: v197 -> v198 -> v203.
- Did not add any IG broker write adapter or change risk/certification gates.
- Corrected the restart verification instructions: `/api/v203/evidence/:id/verify`, not `/api/v203/restart/verify/:id`.

## Deploy
Back up your repository, replace project files with the ZIP contents, commit, and redeploy on Render. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`. Do not use live-account credentials.

## Verify in Render Shell
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for endpoint in status readiness audit; do
  echo "===== v203/$endpoint ====="
  curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Accept: application/json' "$BASE/api/v203/$endpoint" | python3 -m json.tool
done
# Verify existing persisted challenge after Render restart:
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v203/evidence/ec9aa1ec-4e4f-403d-a34d-780a80b94b2b/verify" | python3 -m json.tool
```

Expected: JSON for status/readiness/audit; verify returns `verified:true` only if the persisted evidence exists and its digest matches. The audit may have zero v203 records before evidence is created. No broker orders are permitted.
