# MarketPulse AI v83 — v82 Route Repair + Readiness Diagnostics

## Why
Your Render output showed `v82-readiness.js` and the v82 dashboard existed, but **no v82 route was registered in server.js**. `/api/v82/status` returned the legacy HTML catch-all and `/api/v82/audit` returned HTTP 404. This upgrade adds the missing v82 routes and a separate v83 diagnostic endpoint **before** the catch-all.

## Contents
- `install-v83.js`: guarded, idempotence-aware integration generator. Reads your current `server.js` and writes `server.v83.js` (does not overwrite the original). Requires the known v81 anchor; refuses unrecognised layouts.
- `v82-readiness.js`, `v82-dashboard.html`: existing supervisor components.
- `v83-readiness.js`, `v83-dashboard.html`: read-only cross-version readiness checks.
- `server.v83.js`: **example integrated server based on the supplied v81 baseline**, NOT necessarily your current server. Use the patcher against your actual repository server.js instead.
- `test-v83.js`: mock tests.

## Install (GitHub repository, NOT Render Shell)
1. Back up current `server.js` and persistent storage. Confirm Render broker execution flags are OFF (`BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`, and any legacy broker-enable flags OFF). Keep v54 safety in place.
2. Add `v82-readiness.js`, `v82-dashboard.html`, `v83-readiness.js`, `v83-dashboard.html`, `install-v83.js` to the same directory as `server.js`.
3. In a local checkout or GitHub Codespace, run `node install-v83.js server.js server.v83.js`.
4. Review the diff: `diff -u server.js server.v83.js`. Ensure the only addition is v82/v83 integration before the catch-all. Run `node --check server.v83.js` and `node test-v83.js`.
5. Replace `server.js` with the reviewed `server.v83.js` contents (rename it to `server.js`), commit, redeploy. **Do not deploy both as competing entrypoints**.
6. On Render, check status with the commands below. Do not run the installer on the live container as a deployment method; Render builds from GitHub.

## Verification (Render Shell)
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for endpoint in v81 v82 v83; do
  echo "=== $endpoint ==="
  curl -sS -i -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/$endpoint/status" | head -n 18
done
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v82/audit" | python3 -m json.tool
```
All status endpoints should return `Content-Type: application/json` and HTTP 200. The v82 audit can return 503 if its persistent journal is unhealthy; **do not override that check**.

## Scope and safety
- No IG dealing callback, broker order submission, arming, or unattended IG execution.
- v83 does not certify daily GBP P&L, GBP pip value, delayed-feed status, protective stops, or unknown-submit recovery. All remain blocked.
- Existing legacy broker execution endpoints remain in your server: verify all their execution/auto-start environment flags are OFF; v83 does not disable or secure those older routes.
- v83 dashboard is protected by existing `requireAdmin`; do not expose admin tokens in chat.
