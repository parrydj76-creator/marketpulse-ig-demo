# MarketPulse AI v87 — Mega Verification Workbench

## GitHub-ready direct upload

Back up your repository and Render persistent disk. Upload `server.js` and `v87-verification.js` to your existing GitHub repository root. The ZIP also contains unchanged v86/v85 supporting files for reference and test scripts; keep your existing modules and `public/` directory. Commit and redeploy. No installer or renaming required.

## New features

- `/api/v87/status`: authenticated read-only readiness, risk, feed and evidence-ledger diagnostics.
- `/api/v87/feed`: quote plausibility, spread, local freshness, explicit delay and exchange timestamp evidence; **never** self-certifies exchange data.
- `POST /api/v87/evidence/capture`: authenticated, manually triggered hash-linked append-only evidence snapshots on the existing persistent disk. No secrets, account IDs or broker order requests captured.
- Startup evidence-ledger chain verification and fail-closed response to corruption.
- `/api/v87/arm`: hard-blocked HTTP 409.
- v86 readiness, v85 pause and quarantined historical paper records retained.

## Render Shell checks

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v87/status" | python3 -m json.tool
curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v87/feed" | python3 -m json.tool
curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v87/evidence/capture" | python3 -m json.tool
```

## Limitations and safety

v87 is **not** an unattended broker execution release. It adds no IG dealing calls, cannot authorize orders, and does not certify exchange time, feed delay, IG Mini GBP/pip, minimum size, fees, broker daily P&L, protective stops, unknown-submit reconciliation, or single-writer safety. Evidence is stored in `DATA_DIR/v87-evidence.jsonl` and depends on persistent storage. Do not delete the original v81 journal or quarantine records. Keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false` and paper trading paused.
