# MarketPulse AI v76 — Combined v75 + v76 upgrade

## Scope
This is an **incremental** upgrade for the existing MarketPulse AI GitHub/Render repository, based on the previously supplied v74 `server.js`. It is **not** a complete standalone project. Preserve all existing files, dependencies, environment variables, persistent disks and journal data.

### Included
- `server.js`: v74 baseline plus v76 module wiring, before the catch-all route.
- `v76-workbench.js`: read-only IG account/position/market checks; bounded transaction endpoint probes; structured safe errors; feed/research quality gates; policy readiness; persistent hash-chained audit and simulated-candidate journal.
- `v76-dashboard.html`: admin-protected mobile-friendly diagnostics.
- `test-v76.js`: Node built-in assert tests, including restart and journal corruption.
- `v73-recovery.js`, `v74-operations.js`, `v74-dashboard.html`: included baseline files for reproducibility; only replace these if your GitHub version is older than the v74 package.

## Installation
1. Back up the GitHub repository and persistent disk data. Do not replace/delete journal files.
2. Upload `server.js`, `v76-workbench.js`, `v76-dashboard.html` into the existing repository root (`src/` if that is where `server.js` lives). **Use the included `server.js` only if your current GitHub server.js is the same v74 baseline**; otherwise merge only the `// V76 combined` block immediately before the catch-all route.
3. Keep all prior `v68` through `v74` modules, `v54-safety.js`, and existing dependencies.
4. Run `node --check server.js && node --check v76-workbench.js && node test-v76.js`.
5. Commit to GitHub and deploy Render. Render Shell edits alone are not persistent.
6. Open `/v76` through your existing authenticated browser session.

## Shell checks (never paste secrets)
```
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v76/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v76/audit" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v76/simulate" | python3 -m json.tool
```

## Important limitations
- v76 does **not** place, amend, or close IG orders. `POST /api/v76/arm` always rejects.
- Transactions are diagnostic probes, not certified pagination or a complete GBP financial ledger. A successful HTTP response does not certify daily P&L.
- Read-only checks and simulation are not proof of broker-side risk enforcement.
- Feed delay `null` is unverified. A fresh server receipt is not proof of an undelayed exchange price.
- The existing v74 endpoint may still report a truncated `IG` error code; v76 has its own diagnostics. IG HTTP 500 may remain unresolved until actual responses can be inspected.
- `v76/simulate` records a **candidate**, not a fill or profit. It does not perform live automated trading.
- This package has been syntax-checked and mock-tested locally, not verified against your running IG DEMO/Render service.
- The legacy `server.js` contains older execution pathways; keep the pre-existing v54 broker-write hard block in place and do not set broker execution flags. This upgrade does not independently audit all legacy execution paths.
