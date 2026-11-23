MarketPulse AI v11.0 combined v10.5–v11.0 safety upgrade

INSTALL (GitHub web interface; no Terminal):
1. Back up current server.js and public/operations.html.
2. Replace server.js and public/operations.html from this ZIP.
3. Add marketpulse-v110-boundary.js at repository root.
4. Keep ALL previous v8/v9/v10 modules and data files.
5. Optionally add tests/v110-boundary.test.js.
6. Commit and wait for Render deployment. Open /operations.html.

CHANGES: Explicit fail-closed IG dealing transport checks for known order paths in the central request function and two direct dealing call sites; new read-only audit, seven model recovery scenarios, no new timers. IG authentication and read-only positions requests remain permitted. The v9.1 legacy latch remains unverified and is reported as non-authoritative; no automatic disarming or unlocking.

LIMITATIONS: Not all historical legacy modules are audited. No GBP risk, stop unit, order lifecycle, crash recovery or broker kill switch certification. Broker writes remain hard blocked. No claim that this enables unattended trading.
