# MarketPulse AI v84 — Paper Exit & Recovery Milestone

## Scope
This is an **additive read-only guardian** and an offline replay suite. It does not submit, modify or close any IG order. It does not certify GBP pip value, feed entitlement, broker P&L or broker order lifecycle. Broker execution MUST stay disabled.

## Critical existing v81 issue
The current v81 simulator can evaluate an existing paper position using an invalid/disconnected quote, because exit processing checks only `Number.isFinite` and `0` is finite. This could falsely close a BUY paper position at zero or a SELL paper position at zero. **Do not treat v81 exit statistics as reliable until the v81 simulator is patched and regression tested.** The v84 guardian detects invalid live quotes but cannot stop the existing v81 timer. **This ZIP now includes a guarded v81 source patch**. Apply and test it before deployment. It does not rewrite historical journal records.

## Install (GitHub Codespaces or local checkout)
1. Back up your repo and the Render persistent journal files. Keep `BROKER_DEMO_EXECUTION=false` and `AUTO_START=false` in Render.
2. Upload `v84-guardian.js`, `v84-dashboard.html`, `install-v84.js`, `test-v84.js` to the project root.
3. Run `node test-v84.js`.
4. Run `node patch-v81-safety.js v81-simulator.js v81-simulator.patched.js` and `node test-v81-safety.js v81-simulator.patched.js`. Review `diff -u v81-simulator.js v81-simulator.patched.js` and commit the patched contents as `v81-simulator.js`. Preserve your persistent journal. This patch blocks invalid-price paper exits and counts paper entries on their opening UK date.
5. Run `node install-v84.js server.js server.v84.js` (must already have v81, v82 and v83 integrations).
6. Run `node --check server.v84.js` and `diff -u server.js server.v84.js`. Verify only the v84 block is inserted before the catch-all.
7. **Commit the generated `server.v84.js` contents as `server.js` in GitHub.** Merely uploading `server.v84.js` will not activate it on Render.
8. Redeploy and run the tests below. Do not edit the ephemeral Render shell as a permanent fix.

## Render tests
```
BASE="http://127.0.0.1:${PORT:-10000}"
for version in v81 v82 v83 v84; do
  curl -sS -o /tmp/mp-status.json -w "$version HTTP %{http_code} %{content_type}\n" -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/$version/status"
  head -c 160 /tmp/mp-status.json; echo
done
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v84/audit" | python3 -m json.tool
```

## Next necessary work before unattended DEMO
1. Deploy and verify the included v81 invalid-quote exit guard and daily entry count patch. Confirm that same-tick exit/re-entry stays blocked.
2. Verify paper restart recovery with open positions and a corrupted journal, and test UK-day entry counting across midnight.
3. Inspect sanitized real IG transaction date fields, establish time zone, pagination, fees and financing, reconcile net GBP P&L to account statements.
4. Certify IG EUR/USD Mini pip value and size increments with an independently checked broker statement; certify feed delay.
5. Only after those checks: operator-supervised DEMO order lifecycle with attached stops and crash/unknown-submit reconciliation. No unattended execution until independent review.

## Note on limitations
The replay is a sampled-quote calculation, not a realistic fill simulator. Slippage, gaps, financing and commission are not modeled. It cannot validate broker order safety.
