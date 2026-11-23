MARKETPULSE v7.8 MEMORY RESCUE — CONSERVATIVE DIAGNOSTIC PATCH

Based on the full repository ZIP supplied on 23 November 2026.

Changes:
- server.js: memory logging every 60 seconds instead of every second, with external memory and uptime.
- server.js: new authenticated GET /api/admin/v78/memory endpoint with bounded collection counts.
- package.json: pin Node 22.x rather than >=20.
- Does NOT change broker order gates, trading logic, market subscriptions, persistence or historical engines.

Install via GitHub:
1. Back up the existing server.js and package.json.
2. Replace only these two files in the repository root.
3. Keep every other existing file, including v76 and v77 modules.
4. Commit, deploy and check the Render build log confirms Node 22.
5. Open /api/health and /api/v77/readiness. Confirm all seven feeds reconnect and candles restore.
6. To check /api/admin/v78/memory, send X-Admin-Token header using an authenticated HTTP client. Do not put the token in a browser URL or share it.

WARNING: This is a low-risk diagnostics patch, NOT a proven memory reduction. The repository has many simultaneously active historical engines. Do not disable them without dependency and safety testing. The 512 MB limit may still be exceeded. Broker execution remains hard blocked. Keep the previous deployment for rollback.
