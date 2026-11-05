# MarketPulse AI v7.1 — staged paper-durability upgrade

This is a **safety-staged** upgrade, not an authorization to trade. The broker order blocks remain in place, and `paperRecoveryReady` remains `false` permanently until a separate reviewed activation change. No database migration or historical event mutation is performed.

## Changes
- `paper-durable.js`: copies the simulated engine state, proposes the next event, awaits a PostgreSQL insert, and only then publishes the state change. Duplicate/conflicted writes and database errors do not publish the proposal.
- `paper-recovery.js`: validates OPEN direction and entry, enforces archive chronological order, and exposes a last-signal-bar value for inspection/restoration.
- `server.js`: restores inspected historical counters into a **disabled** engine, replaces fire-and-forget archive flushing with a non-overlapping async durable cycle (still gated off), and fails closed on error.
- `tests/paper-durable.test.js`: 5 unit tests for write failure, commit ordering, matching IDs, duplicate inserts, paused restoration and unresolved restoration refusal.

## Install
1. Back up the GitHub repository. Unzip this package and copy the changed/new files into the repository (or upload the package contents to GitHub, preserving folders).
2. Run `npm ci` and `npm test` locally or in an isolated test environment.
3. Verify `node --check server.js` and review the diff before commit/push.
4. Deploy only to the IG DEMO environment and check `/api/paper/recovery` has `tradingReady:false`. Confirm `/api/paper` shows `enabled:false` after startup inspection.
5. Do not enable the paper loop or remove the IG broker order hard-blocks. No live trading is supported.

## Limitations and follow-up review
- Existing historical OPEN/INTERRUPTED records are retained; interruptions have no realized P/L.
- A crash **after** DB commit but **before** in-memory publication leaves an unresolved archived OPEN, correctly blocking recovery. This requires manual reconciliation, not automatic closure.
- There is no automatic resumption of an unresolved position, no durable manual reset, and no multi-process locking. Paper trading must remain paused until these and additional failure-mode tests are reviewed.
- Unit tests use a fake save function. A live PostgreSQL integration/restart test has **not** been run here.
- P/L is simulated **pips**, not GBP or broker-account profit.
