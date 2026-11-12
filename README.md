# MarketPulse AI v106–v110 Combined Mega Upgrade

## Safety
- Read-only verification only. No IG dealing requests added. `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`.
- The v81 simulator remains paused; historical journals are never rewritten.
- Existing v105 and earlier evidence is preserved. New v110 evidence uses its own hash-linked journal.
- No broker certification is asserted from mock tests or manually supplied data.

## Changes
- v106: Broker evidence freshness gate (60s for observational diagnostics; not execution certification).
- v107: GBP sizing calculator with conservative contract and FX evidence flags.
- v108: GBP balance and charges reconciliation diagnostics, never self-certifying.
- v109: Distributed lease/single-writer **gap reporting**; no distributed lock is claimed or implemented.
- v110: Simulated broker order lifecycle with unknown-submit no-retry and protective-stop fault tests (12 scenarios).

## Deploy
Back up the repository and Render persistent disk. Upload **all runtime JS files** from this ZIP into the existing repository root, preserving names; commit and deploy. Do not delete data journals.

## Verify in Render Shell
```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for route in status diagnostics fault-tests recovery; do
  curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v110/$route" | python3 -m json.tool
done
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v110/evidence/capture" | python3 -m json.tool
```

## Remaining certification blockers
Exchange timestamp and delay; independently verified contract pip value and GBP conversion; broker net daily P&L and fees; actual stop and order lifecycle; unknown submit recovery; distributed single writer; quarantined historical paper accounting. **Do not enable unattended broker trading**.
