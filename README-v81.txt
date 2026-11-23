MARKETPULSE AI v8.1 — CANDLE INTEGRITY & SHADOW DIAGNOSTICS

Install via GitHub web UI (no Terminal):
1. Back up current server.js and public/operations.html. Keep v8.0 ZIP as rollback.
2. Replace server.js in repository root.
3. Add marketpulse-v81-integrity.js in repository root.
4. Replace public/operations.html.
5. Keep marketpulse-v80-shadow.js and all other existing modules unchanged.
6. Optional: add tests/v81-integrity.test.js to your tests folder.
7. Commit and allow Render to deploy. Open /api/health and verify version 8.1.0.
8. Open /operations.html and connect with existing ADMIN_TOKEN. Do not share the token.

NEW authenticated read-only endpoint: GET /api/admin/v81/integrity
Shows 30-bar continuity, first gap, latest bar age, stream freshness,
market status, delayed flag, signal reason, and RAM safety gate.
No REST backfill, fabricated bars, order submission, or readiness bypass.
The existing v8.0 shadow journal remains in place, unchanged.

SAFETY: IG broker execution remains hard blocked. No unattended orders.
Do not delete data/ or journal files. Confirm storage and restore status before
claiming crash recovery. No runtime deployment test was possible here.

Static verification: node --check server.js and module; five isolated unit tests passed.
If memory approaches the Render 512 MB cap, stop adding workload and investigate.
