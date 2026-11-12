# MarketPulse AI v101–v105 Combined Safety Upgrade

This package builds on the **v100 GitHub-ready package** and keeps the IG broker order hard block and the paper simulator pause intact. This release is **read-only** and does not enable unattended trading.

## New features
- v101: quote sanity and local freshness checks; exchange timestamp and delay remain uncertified.
- v102: GBP risk sizing input validation, size-step alignment and daily net-P&L gating; unverified values never certify risk.
- v103: position identity reconciliation and mismatch detection.
- v104: simulated unknown-submit recovery and eight deterministic fail-closed fault checks.
- v105: persistent hash-linked evidence ledger, status, diagnostics, recovery and tests.

## Install
1. Back up GitHub repository and Render persistent data. **Do not replace or delete persistent journals.**
2. Upload the included `server.js` and `v105-combined.js` into the repository root; other existing `.js` modules remain as supplied. Tests are optional to upload.
3. Commit and redeploy. Ensure `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false`.
4. In Render Shell:

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for path in status diagnostics fault-tests recovery; do
  echo "===== $path ====="
  curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v105/$path" | python3 -m json.tool
done
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v105/evidence/capture" | python3 -m json.tool
```

## Limitations
All seven original certification blockers remain. No actual IG order submission, protective-stop lifecycle verification, independent contract-value certification, transaction-to-balance reconciliation, distributed single-writer certification or exchange-delay certification is included. Fault tests are synthetic. Do not infer live-trading readiness from a successful test.

## Tests
`node --check server.js && node --check v105-combined.js && node test-v105.js`
