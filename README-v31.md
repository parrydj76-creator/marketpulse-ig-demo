# MarketPulse AI v31 — IG DEMO Readiness & History Diagnostics

## What changed

- Retains v25–v30 files and modules; adds a self-contained v31 read-only module.
- Verifies the current IG session resolves to a GBP CFD account without exposing account IDs.
- Investigates historical IG transactions using bounded pagination (maximum 10 pages, 100 entries/page).
- Reports transaction field names, hashed matching evidence, and explicit search completeness; does not expose raw transactions.
- Stores investigation results in the configured data directory and displays readiness on `/v31`.
- Preserves broker execution HARD_BLOCKED. No broker order placement, closing, arming, or demo execution approval is added.

## Deploy

Back up your current GitHub project and Render environment configuration. Upload the extracted ZIP contents over the existing project. Do not replace your `.env`, API credentials or durable disk. Redeploy. Run `npm test` and `node --check server.js`.

In Render Shell:

```bash
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v31/status"
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v31/account-check"
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"dealId":"S7PAP8BB"}' "http://127.0.0.1:${PORT:-10000}/api/v31/history/investigate"
```

Open `/v31` for a mobile-friendly diagnostic dashboard. Do not share tokens, account IDs, or full transaction histories.

## Limits and safety

A full page of 100 records may not be the last page. The 10-page cap can leave matches undiscovered. IG transaction API response fields and pagination semantics must be validated against actual IG demo responses. Matching a historical record does not prove open/close confirmation or attached stop. `persistentStorageConfigured` reflects application configuration, not an independently verified crash-safe storage guarantee. Evidence writes are not a transactional, fsync-verified broker order journal.

Before considering autonomous IG DEMO execution, independently verify exact currency-adjusted pip values, instrument size units and stop distances, broker order submission/confirmation, broker reconciliation after network failures, crash-safe order journal, kill switch, limits, and operator approval. Live-money execution is outside this release.
