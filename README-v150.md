# MarketPulse AI v141–v150 — Execution Readiness & Recovery

**No autonomous or manual broker execution is enabled by this release.** No IG dealing callback is passed to v150. `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false` must remain set. This is a targeted upgrade of v140, not a broker-execution certification.

## Real additions

- `/api/v150/status` — single proposed EUR/USD Mini risk policy and inherited v125 health/certification blockers.
- `/api/v150/contracts/compare` — fresh read-only IG GET `/markets/{epic}` calls for `CS.D.EURUSD.MINI.IP` and `CS.D.EURUSD.CFD.IP`, with instrument-specific deal-size and stop metadata. Unknown contract sizes stay unknown. **This does not independently certify GBP pip value.**
- `/api/v150/risk/preview` — fail-closed, human-supplied candidate GBP risk calculation with epic, deal-size step, min size, stop, spread, score, daily trade count, daily loss and exposure guards. Boolean assertions of verification are NOT independent proof; always `certified:false` and `brokerOrderAllowed:false`.
- `/api/v150/rehearsal/run` — **writes only to isolated PostgreSQL rehearsal tables**. Creates a unique `PREPARED` intent, verifies duplicate fingerprint rejection, recomputes event hashes, transitions to `CANCELLED`, re-verifies event hashes. No IG order is placed.
- `/api/v150/rehearsal/verify/:id` — rechecks the same rehearsal intent after a Render restart, proving durable persistence if successful.
- `/api/v150/fault-tests` — 13 additional fail-closed tests.
- `/api/v150/arm` — HTTP 409; execution hard-blocked.

## Critical limitations

- Legacy `/api/admin/trading/*` routes remain in `server.js` unchanged. They may refer to `CS.D.EURUSD.CFD.IP` and a different daily trade cap; v150 does NOT rewire or certify legacy execution. Do not enable `BROKER_DEMO_EXECUTION`.
- `V125_READONLY_POLL_MS=60000` is supported; 30000 is rejected by v125.
- No distributed lease/fencing in broker submission, broker order lifecycle, protective stop test, unknown submission recovery or verified exchange-delay provenance. These remain blockers.
- `v150` read-only contract comparison requires an active authenticated IG DEMO session; GET errors are returned as evidence errors.
- `v150` rehearsal endpoints are intentionally **mutating the rehearsal database**, not the broker. They require admin authentication and a healthy `V125_DATABASE_URL` connection.
- All 7 broker certifications remain outstanding. This release does not change the v140 certification count.

## Install

1. Back up the live GitHub files, Render environment and persistent data. **Diff the included `server.js` against your current live file before replacing it.** This bundle is based on the v140 snapshot, not a fresh export of your live Render filesystem.
2. Extract ZIP and upload the `.js` files to the same GitHub directory, including `server.js` and new `v150-readiness.js`. Keep existing `package.json`, `public/`, `.env` and data journals. Do not upload secrets.
3. Keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`, `V125_READONLY_POLL_MS=60000` and your working `V125_DATABASE_URL`.
4. Deploy and run in Render Shell:

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
for route in status contracts/compare fault-tests; do
  echo "===== V150 $route ====="
  curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v150/$route" | python3 -m json.tool
done
```

5. With rehearsal-only DB writes approved, run the durable test:

```bash
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v150/rehearsal/run" | python3 -m json.tool
```

Copy the returned `id`. After restarting the Render service, replace `YOUR_ID`:

```bash
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v150/rehearsal/verify/YOUR_ID" | python3 -m json.tool
```

Expected: `state: "CANCELLED"`, `eventCount: 2`, `verified: true`, `brokerOrderAllowed: false`. This tests rehearsal persistence only, not unknown broker submission recovery.

## What would actually unlock controlled IG DEMO order tests?

Independently verified IG contract/GBP pip value and size increments, account/fee accounting, genuine non-delayed stream provenance, a broker-connected idempotent intent/reconciliation protocol, fenced distributed lock integrated into dealing path, and explicit operator approval of a small IG DEMO protective-stop lifecycle test. Do not enable unattended trading before those have been tested end to end.
