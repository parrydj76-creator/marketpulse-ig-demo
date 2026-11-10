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
