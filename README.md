# MarketPulse AI — IG demo forex signal starter

Mobile-friendly dashboard using IG REST API candles and a basic EMA(9)/EMA(21) + RSI(14) rule on 5-minute candles. **Signals only. No order-placement endpoints are implemented.**

Official docs: https://www.ig.com/en/trading-platforms/trading-apis/how-to-use-ig-api and https://labs.ig.com/

## Local test (Mac)
1. Install Node.js 20+ from https://nodejs.org/.
2. Extract the ZIP, open Terminal in the folder, and run `cp .env.example .env`.
3. Edit `.env` with your IG API key and the linked demo username/password. Keep `IG_ACCOUNT_TYPE=DEMO`. Never share or commit `.env`.
4. Run `npm install`, then `npm start`.
5. Open http://localhost:3000 and tap **Test IG connection**.

## Deploy on Render
1. Create a private GitHub repository and upload these files, excluding `.env`.
2. In Render choose New → Blueprint and connect the repository.
3. Add environment variables `IG_API_KEY`, `IG_USERNAME`, `IG_PASSWORD`, `IG_ACCOUNT_TYPE=DEMO`, and leave `IG_EPICS` blank at first.
4. Deploy, open the Render URL and tap **Test IG connection**.
5. Tap **Find EUR/USD markets** and select the correct forex CFD market. Copy its exact EPIC.
6. Add that EPIC to Render's `IG_EPICS`, save and restart/redeploy. Comma-separate multiple EPICs.
7. Check `/api/health` and the dashboard.

The demo API uses `https://demo-api.ig.com/gateway/deal`; live mode is not recommended and this app has no order-placement code. If authentication or endpoint versions fail, check current IG Labs docs and API Companion. Keep all credentials in Render secrets. The API key is created under the live account settings; the linked demo login typically must use the same email. Never add live order execution until the strategy has been tested and strict risk limits, duplicate-order protection, stale-price rejection, audit logging and an emergency stop are in place.

This starter polls REST candles every 60 seconds, not streaming ticks. Browser alerts may require the page to be active; reliable iPhone background push needs a push service. The strategy is not a validated profitable system. Check market-data entitlements, API limits and spread effects before relying on signals.
