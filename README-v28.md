# MarketPulse v28 — broker verification preparation

This upgrade **does not certify** IG monetary sizing, broker lifecycle, or recovery. Those require independently observed broker data and controlled demo transactions. The existing hard block on broker orders remains unchanged.

## Deploy
Back up your repository. Replace files with this ZIP's contents, retaining existing secrets in Render Environment (never commit .env). Deploy one instance. Run `npm test` and `node --check server.js` before deployment. Do not enable IG broker execution environment flags.

## Render Shell (admin token remains private)
```
curl -sS -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v28/status"
curl -sS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:${PORT:-10000}/api/v28/collect"
```
The collect endpoint requests IG **read-only** market specs, account types/currencies, and open positions. It stores a digest in the existing v27 evidence journal, which requires persistent storage for restart durability. Do not post raw results publicly: positions may include broker identifiers.

POST `/api/v28/risk-preview` with JSON `size`, `stopPips`, `pipValueQuote`, `quoteToGBP`, `feesGBP`, `slippagePips`, `budgetGBP`, `step`, `minSize`. This is mathematical simulation, **not** independently verified broker sizing.

POST `/api/v28/recovery-preview` with JSON `journal`, `positions`, and optional `confirmations` to classify simulated in-flight cases. Ambiguous broker actions always require manual reconciliation, never automatic resubmission.

## Remaining acceptance tests before demo broker automation
1. Independently confirm contract denomination, pip value, FX conversion, dealing-rule quantity units and increment with IG and controlled demo evidence.
2. Observe accepted/rejected demo order confirmations, attached protective stops, partial fills if applicable, and explicit close results.
3. Compare broker positions, confirmations, and transaction history across multiple restarts, including network timeouts and unknown submission outcomes.
4. Demonstrate a durable transactional order journal and recovery with no duplicate orders; enforce risk limits, account isolation, explicit approval and emergency stop.
5. Require human review of evidence before changing any broker execution gate. **Live-account trading must remain disabled.**
