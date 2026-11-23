MarketPulse AI v10.1-v10.4 Combined Safety & Recovery Evidence

Install using GitHub (no Terminal): back up your existing server.js and public/operations.html, replace with these files, add marketpulse-v104-safety-lab.js, keep all previous modules and persistent data. Commit to deploy.

Open /operations.html and connect using your admin token. New panel: v10.1-v10.4 Safety & Recovery Evidence.

Read-only diagnostics. The 6 failure scenarios are MODEL PLANS ONLY, not broker-tested. This package does NOT consolidate enforcement in all broker write pathways, does NOT enable IG DEMO orders, and does NOT certify risk, recovery or kill-switch behavior. Broker execution remains hard-blocked in server.js.

Testing: node --check server.js; node --check marketpulse-v104-safety-lab.js; node --test tests/v104-safety.test.js.
