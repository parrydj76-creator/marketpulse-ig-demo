# MarketPulse v66.1 — read-only certification evidence

Replace **v66-dealing.js** in the GitHub repository root with the included file.
The included **server.js** is an unchanged copy of your uploaded file, for reference only. No server.js replacement is required if the deployed file already matches.

The new endpoint is `POST /api/v66/certification-preview`. It uses the existing read-only IG DEMO market callback.

Render Shell:
```
BASE="http://127.0.0.1:${PORT:-10000}"
curl -sS --fail-with-body -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' "$BASE/api/v66/certification-preview" | python3 -m json.tool
```

This patch does NOT certify GBP sizing, does NOT establish a live streaming Mini quote, does NOT enable broker writes, and does NOT enable unattended execution. Keep all supervised write flags disabled.

Back up your repository and persistent journal before deploying. Test in IG DEMO only.
