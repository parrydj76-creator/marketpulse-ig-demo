# MarketPulse AI v85 — Mega Simulation Safety Repair

**PAPER-ONLY. IG broker order execution remains HARD BLOCKED.** This package is based on the supplied v81/v84 source references, not a live copy of your current GitHub checkout. The guarded installer must be run against your actual files. It refuses unexpected layouts and never overwrites them.

## What this fixes

- **Default persistent paper safety hold**: without a valid `v85-paper-control.json` containing `paused:false`, all scheduled and manual v81 ticks throw `V85_PAPER_SAFETY_HOLD` before writing to the journal. A restart does not bypass the hold.
- **Zero-price/disconnected/stale feed protection**: v81 requires connected, fresh, non-crossed EUR/USD quotes in a plausible 0.5–2.0 range before paper exits. A missing quote cannot close a SELL at zero.
- **Immutable historical quarantine**: invalid closed trades (including zero-price exits) remain in the original hash-linked v81 journal but are excluded from the v85 valid simulated P&L and the v81 daily realized-P&L decision. The historical daily trade count still includes all entries so invalid fills do not reset the limit.
- **Guarded pause/resume**: admin-only `/api/v85/pause` and `/api/v85/resume`, resume requires JSON `{"confirm":"RESUME_PAPER_ONLY"}` and healthy persistence, journal and feed. Resume is for paper simulation **only**.
- **Audit endpoints**: `/api/v85/status` and POST `/api/v85/audit`, reporting quarantine counts and journal integrity. No broker order callback is supplied.
- **Regression tests**: default pause, manual tick block, invalid zero SELL exit, valid SELL stop, restart recovery, quarantine and integrity.

## Important limitations

- The persistent pause control file and the existing `v81-paper-journal.jsonl` must live on the **same durable DATA_DIR**. If the disk is not persistent, the engine fails closed.
- `v81.status().latestClosed` still displays raw historical records for audit; use `v85.validSimulatedPnlGBP` for filtered **paper** P&L. Never use the prior £44,373 as performance.
- v85's integrity audit examines the last state in the hash-linked journal. It does not erase or rewrite history, and cannot certify broker executions, actual historical fills, market-data delay, GBP pip value, transaction fees, broker daily P&L, protective stops, or crash-safe broker submission.
- Simulator still assumes £1/pip/unit and ignores financing, slippage and commission; results are **not** broker-account P&L.
- No real broker trading is enabled; keep `BROKER_DEMO_EXECUTION=false`, `AUTO_START=false`.
- Pausing freezes open paper positions. It does not close them; restarting/resuming may cause a simulated gap exit at the first valid quote.
- Installer only supports the exact v81 source layout and the v84 server route marker. Refusal is intentional. Review all diffs.

## GitHub Codespace/local checkout (not Render Shell)

1. Back up your repository and **persistent journal** (never commit credentials or private journal data). Set `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false` on Render.
2. Copy `v85-integrity.js`, `install-v85.js`, `test-v85.js`, and `test-v85-integration.js` into your project. The `*.example.js` files are **reference outputs only** and must not be blindly deployed.
3. Generate patched copies from **your actual current** `server.js` and `v81-simulator.js`:

```bash
node install-v85.js server.js v81-simulator.js server.v85.js v81-simulator.v85.js
node --check server.v85.js
node --check v81-simulator.v85.js
node test-v85.js
# Test integration against the generated simulator (see next line)
cp v81-simulator.v85.js v81-simulator.v85.example.js
node test-v85-integration.js
```

4. Review `diff -u server.js server.v85.js` and `diff -u v81-simulator.js v81-simulator.v85.js`.
5. After review, replace `server.js` and `v81-simulator.js` in your **GitHub checkout**, commit and deploy to Render. Do **not** deploy `server.v85.js` without replacing the active `server.js`.
6. v85 **defaults to PAUSED** even though the 15-second timer may show `scheduled:true`. A timer being scheduled does not mean paper trading is permitted. Check `paused:true`.

## Render Shell tests

```bash
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v85/status" | python3 -m json.tool
curl -sS --fail-with-body -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v81/status" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v85/pause" | python3 -m json.tool
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v85/audit" | python3 -m json.tool
```

Only **after** you inspect v85 quarantine and confirm the feed and paper-position state, you may explicitly resume paper simulation:

```bash
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"confirm":"RESUME_PAPER_ONLY"}' "$BASE/api/v85/resume" | python3 -m json.tool
```

To pause again:

```bash
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/v85/pause" | python3 -m json.tool
```

**Note**: These endpoints only affect paper simulation. They do not enable broker orders.
