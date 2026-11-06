# MarketPulse AI v18 — Read-only IG DEMO readiness preview

This is a safe incremental preview, **not** an automated IG DEMO trading engine. Broker orders remain hard-blocked.

## Files
- `server.js`: v17 supplied server with an additive v18 route before the catch-all. Compare/merge if your live server has changed.
- `v18-demo-readiness.js`: authenticated, read-only readiness diagnostics. No IG POST methods.
- `public/v18.html`: mobile-friendly readiness dashboard.
- `tests/v18-demo-readiness.test.js`: basic local checks.

## Install
1. **Back up your complete live GitHub repository and Render configuration.**
2. Copy `v18-demo-readiness.js` to repository root and `public/v18.html` to public folder.
3. **Merge**, rather than blindly replace, the v18 route block from the included `server.js` into your current live `server.js` immediately before the `app.get('*', ...)` catch-all.
4. Keep all other modules (`v9`–`v17`, `push-alerts`, `paper-*`, `package.json`, `public/sw.js`, etc.) unchanged.
5. Deploy; visit `/v18`, enter existing `ADMIN_TOKEN` in your deployed app, and select Check readiness.
6. Confirm `/`, `/v17`, push subscriptions and IG streaming still work. Do not share tokens or credentials in chat.

## Limitations
- The uploaded ZIP contained only 5 v17 patch files, **not the full running GitHub repository**. An end-to-end deployment/runtime test was therefore impossible. Local unit tests verify only the isolated v18 readiness module.
- This release does not execute, open, close or simulate broker orders; it adds no IG POST endpoints.
- v17 readiness flags are reported as supplied, not independently verified by v18. Do not infer readiness from manually changed flags.
- Existing hard broker block in `openDemo()` remains unchanged.
- The next milestone requires the **full repository** and verified IG instrument contract, GBP/pip and FX conversion, minimum size and stop distances, order acknowledgement, reconciliation and crash recovery.
