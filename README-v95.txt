MarketPulse AI v9.2–v9.5 Combined Safety Upgrade

GitHub installation (no Terminal):
1. Back up your repository and ensure the current shadow journal is preserved.
2. Replace server.js with this package version.
3. Add marketpulse-v95-safety.js to repository root.
4. Replace public/operations.html.
5. Leave all previous modules and data unchanged. Commit and deploy Render.
6. Visit /operations.html and connect with your existing admin token.
7. Use “Persist emergency latch” to verify a durable file write; use “Inspect FX conversions and IG positions” for GET-only broker evidence.

Stages combined:
v9.2 — Durable local latch readback, fsync and fail-closed reporting. IMPORTANT: the existing v9.1 latch is separate; v9.5 does NOT control the legacy broker execution path.
v9.3 — Additional indicative GBP conversion routes (GBPJPY, GBPCHF, GBPCAD). Quote staleness/delay must be zero for indicative values. Conversion and deal size are NOT certified.
v9.4 — Read-only IG position snapshots and changes between inspections. This is NOT order lifecycle or crash-recovery certification.
v9.5 — Safety evidence and browser blockers; five model-only fault scenarios.

All broker orders remain hard-blocked. This upgrade makes NO IG write calls. No broker-connected kill switch or real broker lifecycle test is performed. Render Free may suspend services and has insufficient RAM headroom for reliable unattended execution.

Endpoints (admin protected): GET /api/admin/v95/lab; POST /api/admin/v95/inspect; POST /api/admin/v95/engage.
Never share ADMIN_TOKEN or upload .env, secrets, or trading data.
