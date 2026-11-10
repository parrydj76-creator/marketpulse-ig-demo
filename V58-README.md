# MarketPulse AI v58 — PAPER ONLY

This release is NOT IG DEMO execution. Broker order writes remain hard blocked. The CFD stream is a proxy for Mini pricing; simulated P/L is hypothetical. Do not treat simulated stop-losses as guaranteed fills.

## Upgrade from v57
1. In Render, **disarm v57** using `POST /api/v57/stop-paper` before deployment. Confirm `autoPaperArmed:false`. Do not arm v56 or v57 after migration.
2. Back up your persistent disk, especially `v57-auto-paper.jsonl`. Do not remove or replace it. Deploy all files from this ZIP to the existing repository root. Keep existing Render disk, admin token, and `V57_INDICATIVE_USD_TO_GBP` setting.
3. v58 verifies the v57 journal hash chain, imports the existing open position into a new `v58-paper.jsonl` migration record, and does not alter v57 journal. The old journal must remain unchanged after migration. If it changes, v58 refuses cycles until manually reviewed.
4. Check `GET /api/v58/status` with `X-Admin-Token` header. Verify `journalHealthy:true`, `legacyMigrated:true`, `legacyOpenImported:1` (if your v57 position remains open), `openPaperPositions:1`, `monitorArmed:false`, `entryArmed:false`.
5. First run `POST /api/v58/arm-monitor`, then `POST /api/v58/cycle` and `GET /api/v58/status`. This monitors and may close the existing simulated position if the current quote crosses a threshold, but cannot open a new one.
6. Only after checking results, optionally run `POST /api/v58/arm-entries` to enable new paper entries. `POST /api/v58/stop` disarms monitoring and entries. After a restart both are disarmed by default.
7. Dashboard: `/v58` on your Render host. Requires admin token in a password field; the token is held in browser memory only and not stored by the page.

## Render Shell
```
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v58/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v58/arm-monitor" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v58/cycle" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v58/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v58/stop" | python3 -m json.tool
```

## Safety and limits
- Monitoring requires fresh, non-delayed STREAM CFD proxy bid/ask, market DEAL, max 15s quote age. Stale quotes cannot trigger a simulated close; this means missed gaps and delayed exits are possible.
- Entry requires a separate valid RSI/EMA signal, score >=70, 30 bars, spread <=2.5 pips, configured indicative USD/GBP, max £25 indicative risk, <=3 trades/day, <=£100 closed losses/day, GBP account and broker readback with no Mini broker position.
- Existing positions can be monitored and paper-closed even if the signal score is low, GBP conversion is missing, or entry risk caps are reached. P/L uses the conversion stored at entry.
- Imported v57 history is snapshotted; it is not duplicated into the original journal. v58 will reject any subsequent modification of the legacy journal.
- This is not crash-safe broker execution, real stop protection, certified contract sizing, or unattended IG dealing. No automatic IG DEMO orders.
