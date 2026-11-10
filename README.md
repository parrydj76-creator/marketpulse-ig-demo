# MarketPulse AI v65 — Compact GitHub Deployment

This package retains the runtime files from the v65 combined release, removes older version-specific README files and excludes development tests. Keep the existing Render environment variables and persistent disk. The root layout is unchanged (`server.js`, `package.json`, `public/`).

**Safety:** IG broker writes and unattended trading remain blocked. Do not turn on legacy execution flags. This package is not certified for broker order submission.


---

## V65-README.md

# MarketPulse AI v65 — combined execution candidate

This combines durable operator-controlled *rehearsal* intents, restart-safe hash-chained journal, duplicate prevention, recovery drills, emergency halt, IG account/position and EUR/USD Mini market preflight, and a fail-closed broker-write block.

**This release does not place, close, or modify IG orders.** It does not certify GBP monetary sizing, broker order lifecycle, ambiguous network response recovery, or unattended execution. All four certifications remain false. `approve-rehearsal` is evidence only, not broker authorization. Do not enable legacy execution environment flags.

## Deployment

Back up repository and Render persistent data before updating. Upload ZIP contents into the GitHub repository root, redeploy, and confirm Render persistent disk is mounted. `PERSISTENT_STORAGE_CONFIRMED=true` must be set only if persistent storage is actually configured. Keep IG_ACCOUNT_TYPE=DEMO and existing broker dealing switches disabled. Never paste API keys or admin tokens into chats.

## Render Shell — read-only checks

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v65/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v65/preflight" | python3 -m json.tool
```

Other endpoints (all require X-Admin-Token):
- GET `/api/v65/intents`
- POST `/api/v65/prepare` with `{ "id":"unique-identifier-001", "direction":"BUY", "size":0.1, "stopPips":12, "targetPips":18 }` after preflight
- POST `/api/v65/approve-rehearsal` with `{ "id":"unique-identifier-001", "confirm":"REHEARSE_unique-identifier-001" }`
- POST `/api/v65/recovery-drill` with `{ "id":"unique-identifier-001" }`
- POST `/api/v65/cancel` with `{ "id":"unique-identifier-001" }`
- POST `/api/v65/emergency-halt` with `{ "confirm":"HALT_V65" }` (irreversible in v65; no clear-halt endpoint)

All v65 broker-write endpoints explicitly reject requests. This emergency halt applies to v65 workflows, not existing manual IG positions or every legacy module; use IG directly for real position emergencies.

## Next implementation requirements

A separate supervised IG DEMO dealing adapter must be reviewed against current IG documentation, including payload schemas and confirmation polling; exact GBP pip exposure and stop-loss attachment must be verified with broker readback; ambiguous timeout recovery must be demonstrated without duplicate submissions; and a complete supervised open/close cycle must pass. Only then can unattended DEMO certification be considered, and it requires separate explicit activation.


---

## DEPLOY-COMPACT.md

# MarketPulse AI v53 — compact, GitHub-ready release

This ZIP is **flat at the root**, like the earlier GitHub-ready packages. Upload its **contents**, not an enclosing folder.

## Changes
- Removed five superseded version-specific README files (V48–V52).
- Kept README.md and V53-README.md, current and historical server routes, required JavaScript modules, dashboards, tests, package.json and package-lock.json.
- No credentials, node_modules or persisted journals included.
- Sorted entries for predictable extraction.

## Deploy
1. Extract ZIP and upload files/folders to the repository root, preserving `public/` and `tests/`.
2. Delete superseded V48-README.md through V52-README.md from GitHub if you want the repository to match this release; uploading a ZIP does not delete existing repository files.
3. Commit and redeploy Render.
4. Verify `/api/v53/status` and `/api/v53/transactions`.

## Important
This is a **safe cleanup**, not a breaking architectural rewrite. Many older version modules and dashboards are still registered by server.js and cannot be deleted without refactoring and testing those routes. Broker execution remains blocked for the v53 certification workbench; check any legacy execution configuration separately.


---

## CONSOLIDATION.md

# MarketPulse AI v55 — consolidated distribution

The historical v9–v52 JavaScript modules are packaged into `legacy-bundle.js`, while their CommonJS scopes and exports are preserved. v53–v55 remain standalone for independent safety review. The bundle is source code, not minified.

The existing `server.js`, dashboard assets, runtime dependencies, data directory paths, environment variables, and all current API routes are retained. The application still enforces its central broker-write block. This release does **not** enable unattended IG orders.

## Deployment

1. Back up your GitHub repository and persistent data.
2. Upload the contents of this ZIP at the repository root.
3. Delete old root `v9-*.js` through `v52-*.js` files **after** committing the new `legacy-bundle.js` and `server.js`; otherwise the repository is not actually consolidated. Do not delete `v53-evidence.js`, `v54-safety.js`, or `v55-supervised.js`.
4. Preserve Render environment variables and persistent disk.
5. Redeploy and verify `/api/v55/status`, `/api/v55/inspect`, and the `/v55` dashboard.

`npm test` runs the regression suite. The package has not been validated against a live IG DEMO session in this build environment.

**Safety:** `HARD_BLOCKED` remains required. Broker-order execution must not be enabled by environment variables or older endpoints.

