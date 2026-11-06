# MarketPulse AI v22 installation

1. Unzip and upload the CONTENTS of `marketpulse-ig-demo-main` into the ROOT of your existing GitHub repository, preserving subfolders. Do not upload a second nested project folder.
2. Commit and wait for Render deployment. Keep existing Render environment variables and DATABASE_URL. Do not paste tokens into ChatGPT.
3. Open https://marketpulse-ig-demo.onrender.com/v22 and enter ADMIN_TOKEN in the deployed page.
4. Check Readiness, Read-only IG check, and Recovery status.
5. Create a simulated intent and test valid simulated transitions; refresh journal to confirm persistence.
6. Create a marker, copy its ID, manually restart Render, and verify it afterwards. This confirms record persistence only; not in-flight broker recovery.
7. Run `npm test` locally or in CI to execute existing and new tests.

## v23 roadmap
Independent IG instrument-specific GBP/pip and minimum-size evidence; broker-order lifecycle sandbox validation; order timeout/reconciliation with durable idempotency; controlled restart and multi-worker tests; operator approvals. Keep all broker write APIs hard-blocked until gates independently pass.

## Safety
This release DOES NOT place IG broker orders. User-entered evidence flags cannot verify contract sizing. Simulation risk limits do not guarantee losses. No production or live trading.
