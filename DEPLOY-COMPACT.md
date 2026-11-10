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
