# MarketPulse AI v55 — Supervised DEMO Safety Verification

## Scope
- Flat GitHub-ready project. All prior modules are retained because `server.js` still imports them. Do not delete old modules until route and dependency consolidation is tested.
- Adds a hash-linked persistent v55 evidence journal, immutable client intent IDs, pending operator-review lockout, broker position inspection, indicative GBP risk review, daily-limit review, and an emergency-stop latch.
- Broker write requests are blocked by the existing central v54 request gate; v55 contains no dealing adapter.
- This release **does not certify** GBP sizing, broker lifecycle, ambiguous in-flight order recovery, or unattended execution.
- The operator-provided daily loss and trade count are NOT broker-verified. Limit review is advisory and never authorizes broker writes.

## Deploy
Extract ZIP and upload its *contents* into the existing GitHub repo root. Retain Render environment variables and persistent disk. Avoid uploading `node_modules`, secrets, or journal data. Render deploy: `npm start`.

## Verify in Render Shell
```sh
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v55/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v55/inspect" | python3 -m json.tool
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v55/arm-unattended" | python3 -m json.tool
```

## Safety
Never enable legacy broker execution environment switches. All v55 proposals are review-only and cannot place trades. Emergency stop does not close positions; manage any real DEMO positions directly through IG.
