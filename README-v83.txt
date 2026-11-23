MarketPulse AI v8.3 MULTI-UPGRADE: shadow performance + journal verification + restart evidence + browser dashboard.

GitHub installation (no Terminal):
1. Keep a backup of your current server.js and public/operations.html.
2. Replace root server.js with this package's server.js.
3. Add root marketpulse-v83-certification.js.
4. Replace public/operations.html.
5. Keep ALL existing modules, especially marketpulse-v80-shadow.js, marketpulse-v81-integrity.js and marketpulse-v82-audit.js. Do not delete persistent data.
6. Commit and wait for Render to redeploy. Open /operations.html and connect with your existing ADMIN_TOKEN.

The v8.3 dashboard is read-only. The certification endpoint is GET /api/admin/v83/certification, authenticated with X-Admin-Token.
Retained journal data (max 120 events) is NOT complete lifetime analytics. Restoration is only verified when status becomes RESTORED after a restart; do not restart while a simulated position is open just to test it.
No IG broker order execution is enabled. Existing hard blocks remain in place.

Tests: node --test tests/v83-certification.test.js (optional; no Mac Terminal required for deployment).
