MarketPulse v7.7.0 — passive shadow evidence + recovery diagnostics

Upload server.js and marketpulse-v77-shadow.js to the GitHub repository ROOT. KEEP the existing marketpulse-v76-readiness.js and all other modules.

New endpoints:
GET /api/v77/readiness — public, no account identifiers
GET /api/v77/diagnostics — ADMIN_TOKEN required via X-Admin-Token header

Features: bounded RSS/heap trends; disk candle-file checks; read-only seven-market shadow signal eligibility; persistent bounded evidence on actionable signal transitions; restored journal status. Existing server.js already persists stream-candles.json and restores it on boot. This upgrade does not change that logic.

Important: no autonomous simulation, broker order placement or execution enabling. Shadow signals are not probabilities or trades. Do not enable broker execution. Render Free is not reliable always-on hosting.

Deploy then inspect /api/health, /api/v76/readiness and /api/v77/readiness. Keep a copy of your current working server.js for rollback.
