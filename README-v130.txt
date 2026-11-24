MarketPulse AI v13.0 — PRE-UNATTENDED ENGINEERING AUDIT

NO BROKER ORDERS. This release is an on-demand audit, not unattended execution.

INSTALL WITHOUT TERMINAL:
1. Back up current server.js and public/operations.html in GitHub.
2. Replace server.js and public/operations.html from this ZIP.
3. Add marketpulse-v130-readiness.js at repository root.
4. Retain existing v8–v12 modules including marketpulse-v110-boundary.js.
5. Commit and allow Render to redeploy.
6. Open /operations.html and review v13.0 Pre-Unattended Engineering Audit.

This release adds an on-demand, admin-authenticated code-path inventory (heuristic),
a consolidated durable latch / RAM / feed status, and explicit certification barriers.
It does not reduce RAM use, change strategy, perform IG orders, certify GBP pip value,
validate stop units, or prove broker crash recovery / kill-switch enforcement.
Do not enable broker execution. Keep existing emergency latch ENGAGED.

The source inventory may miss dynamic code, dependencies, or bundled code.
The endpoint returns filenames and source fingerprints; keep the admin token private.
