MarketPulse AI v8.8 combined v8.5–v8.8 upgrade

Install without Mac Terminal:
1. Back up your current GitHub server.js and public/operations.html.
2. Replace server.js and public/operations.html with these files.
3. Add marketpulse-v88-evidence.js at repository root.
4. Optionally add tests/v88-evidence.test.js.
5. KEEP ALL EXISTING v8.0–v8.4 modules and journal data. Do not overwrite persistent disk.
6. Commit, deploy Render and open /operations.html.

New authenticated GET /api/admin/v88/evidence.

Features: retained-trade integrity and performance, disk/live shadow-position consistency, synthetic GBP risk examples, fault scenario plans, explicit safety blockers, and browser dashboard.

No broker orders. No trading strategy changes. No background timers. No automatic repair. IG broker GBP pip value, stop units, lifecycle, crash recovery and kill switch remain UNCERTIFIED.

This is static/unit tested locally; live Render behaviour must be checked.
