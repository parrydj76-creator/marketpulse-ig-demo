# MarketPulse AI v80 — Autonomous Read-Only Certification Mega Upgrade

**This is a v77 → v80 incremental upgrade, not a fully autonomous IG dealing bot.** It runs automatic read-only audits every 60 seconds, identifies transaction date/P&L formats without exposing raw values, checks live stream and research status, and persists hash-linked evidence. **IG broker orders remain blocked.**

## Files
- `v80-autonomy.js`: read-only audit, fail-closed certification, transaction format diagnostics, durable journal, scheduled checks.
- `v80-dashboard.html`: mobile-friendly audit screen (admin token entered locally in browser, not stored).
- `server.js`: supplied v77 baseline with new v80 integration. **Do not overwrite a diverged server.js.**
- `test-v80.js`: local unit, audit, restart and corruption tests.

## Installation
1. Back up GitHub repo and Render persistent disk. Keep v54 and all prior modules (`v68`, `v71`, `v76`, `v77`, etc.).
2. Upload `v80-autonomy.js` and `v80-dashboard.html` beside `server.js`.
3. If your `server.js` is identical to the included v77 baseline, use the included `server.js`. **Otherwise merge only the `// V80 autonomous research and certification` block from the included `server.js`, immediately before the catch-all route.** Never overwrite subsequent fixes.
4. Run `node --check server.js && node --check v80-autonomy.js && node test-v80.js`.
5. Commit changes to GitHub and redeploy Render. Ensure `PERSISTENT_STORAGE_CONFIRMED=true` is accurate and the Render disk is mounted. If storage is absent, audit fails closed.
6. Do not enable `BROKER_DEMO_EXECUTION`, `AUTO_START`, or any legacy execution flag. Preserve `v54-safety` and existing protections.

## Render test
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v80/audit" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v80/status" | python3 -m json.tool
```
Dashboard: `/v80`. Evidence: `GET /api/v80/evidence`. Arm: `POST /api/v80/arm` always HTTP 409.

## Explicit limitations
- The known working IG v1 seven-day endpoint returns data but does **not** establish completeness/pagination. No certified daily net GBP P&L or enforceable £100 broker loss cap yet.
- Date-only or timezone-free IG dates are classified, not converted to UK time. Format classification is **not** timezone verification.
- GBP pip value, deal increments, fees, financing, feed entitlement/delay, broker stop attachment, uncertain-submit recovery and supervised broker lifecycle remain uncertified.
- `simulationCandidateEligible` is a **research readiness flag**, not a simulated trade or permission to trade. V80 does not submit orders, create simulated fills, or manage simulated positions. No real DEMO broker test trades are performed.
- This package does not certify or remove any historical legacy execution paths. Existing execution flags must stay off.
- Locally tested with mocks only; actual IG DEMO validation requires running the audit after deployment.
