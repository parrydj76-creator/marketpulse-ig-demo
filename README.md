# MarketPulse AI — GitHub-ready v47 deployment

This is a **file-management consolidation only**, based on the supplied v47 archive. All runtime JS modules and dashboard assets remain unchanged. No v48 Mini integration or trading permission is included.

## Deploy

- Upload the **contents of this folder** to the root of the existing GitHub repository, preserving `public/`. GitHub does not unpack a ZIP uploaded as a file.
- Keep the existing Render environment variables, persistent disk and build/start commands.
- Build: `npm install` (or `npm ci`); start: `npm start`.
- Check `GET /api/v47/status` with the existing admin token after deployment.
- Broker execution must remain disabled. Do not enable legacy order flags or arm any order routes.

## What's been consolidated

Historical README and INSTALL versions, plus tests, have been moved into the separate development archive. Runtime files remain separate because they are imported by `server.js`; deleting or renaming them would break the deployed app. The separate archive can be kept outside the deployed repository.

## Caution

The `render.yaml` file is copied verbatim from the supplied archive. Check its settings against your actual Render service before using Blueprint sync; an existing service may have different disk/environment settings.

The IG EUR/USD Mini epic `CS.D.EURUSD.MINI.IP` was independently discovered by the user but is **not integrated** in this v47 packaging release.
