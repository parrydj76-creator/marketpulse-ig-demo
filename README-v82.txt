MarketPulse AI v8.2 — Candle Continuity & Restart Audit

INSTALL VIA GITHUB (NO TERMINAL):
1. Back up existing server.js and public/operations.html.
2. Replace root server.js with this version.
3. Add root marketpulse-v82-audit.js.
4. Replace public/operations.html.
5. Keep v8.0 and v8.1 modules and all other repository files unchanged.
6. Commit and allow Render to deploy.
7. Visit /operations.html and enter your existing ADMIN_TOKEN in browser only.

This upgrade provides a read-only startup vs current disk/memory candle audit, explicit continuity gaps, and shadow journal visibility. It does NOT repair candles, enable broker execution, or certify crash recovery.

Do not upload .env, admin tokens, account credentials, or data directory.
