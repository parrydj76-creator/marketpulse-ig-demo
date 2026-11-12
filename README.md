# MarketPulse AI v97–v100 combined — READ ONLY

Built on the supplied v96 ZIP. Upload all runtime JS files (server.js, v81-simulator.js, v85-integrity.js, v86-readiness.js, v87-verification.js, v88-broker-audit.js, v91-combined.js, v95-combined.js, v96-diagnostics.js, v100-combined.js) to your existing GitHub project. Back up repository and Render persistent disk before deployment. Do not upload tests as runtime dependencies. No rename or installer.

## Contents
- v97: v100 status reads v95's latest in-process evidence, rather than an independently stale history result.
- v98: transaction classification and strict numeric diagnostic calculations (NOT net daily P&L certification).
- v99: conservative hypothetical GBP risk and position discrepancy helpers; no assumed pip value or size.
- v100: simulated UNKNOWN submit fail-closed policy, append-only hash-linked diagnostics, restart integrity checks.

## Safety
No IG dealing endpoints, no automatic arming, no broker order writes. Historical paper journal is untouched. IG demo execution must remain disabled: `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`. Existing legacy server trading paths were retained; verify all execution flags are off before deployment. This release does NOT resolve exchange timestamp/delay, GBP pip value, broker net daily P&L, protective stop lifecycle, unknown submit broker recovery, or distributed lock certification. No new certificate is granted.

## Render verification
```
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v100/status" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v100/diagnostics" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v100/evidence/capture" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v100/recovery" | python3 -m json.tool
```
The evidence capture is local diagnostic only. v95 read-only capture still handles IG requests. Do not expose ADMIN_TOKEN in chat.

## Limitations
- v100 diagnostics do not fetch raw transaction rows, and cannot reconcile fees or net daily broker P&L. `accounting([])` is deliberately a placeholder diagnostic, not an account result.
- `reconcile` is a count-level alarm only, not deal-ID reconciliation.
- Unknown-submit recovery is a simulated policy, not certified IG lifecycle behavior.
- Multi-instance lock is not certified.
- v95 date range and pagination behavior are unchanged from v96.
