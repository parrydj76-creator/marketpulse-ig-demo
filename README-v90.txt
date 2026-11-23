MarketPulse AI v9.0 IG DEMO Certification Lab — read-only.

GitHub installation (no Terminal):
1. Back up current server.js and public/operations.html.
2. Replace server.js with the included file.
3. Add marketpulse-v90-lab.js to repository root.
4. Replace public/operations.html.
5. Keep existing v8.0-v8.8 and legacy modules unchanged.
6. Commit; wait for Render deployment.
7. Open /operations.html, connect with existing admin token, click Read IG market specifications.

Endpoints: GET /api/admin/v90/lab and POST /api/admin/v90/scan (admin authenticated).
POST scan makes only IG GET /markets/{epic} requests for 7 majors, on demand.
IG GBP per pip is NOT certified by the returned raw valueOfOnePip; quote currencies, contract unit, size and GBP conversion need independent verification. Stop units need validated mapping.
Lifecycle and kill-switch checks are pure local simulations, NOT actual IG order or kill-switch tests.
No broker writes; original BROKER_DEMO_EXECUTION=false remains.
Keep on Render Free for diagnostics/shadow only; do not use for reliable unattended broker execution.
