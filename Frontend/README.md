# VOOTED Frontend

React + Vite SPA for VOOTED.

## Main pages

- / : Dashboard (single URL queue flow, job list, queue controls)
- /jobs/:jobId : Job detail view (logs, status, actions)
- /channel-streams : Channel streams discovery and bulk queue
- /settings : Runtime app/logging/downloader/cookie settings

## UI behavior

- First-run setup screen when backend reports setup required
- Polling-based live updates for jobs and runtime metadata
- Themed modal system for confirmations and workflows
- Close App modal with alive/dead server awareness

## Runtime config behavior

Frontend reads settings from backend APIs, not from static build-time constants:

- GET /api/settings
- PATCH /api/settings

Important app setting now surfaced in UI:

- Default channel URL (used to prefill Channel Streams page)

## Quality presets

The quality selector supports:

- Best available (up to 1440p60)
- 1080p (up to 60fps)
- 1080p 30fps
- 720p (up to 60fps)
- 720p 30fps
- 480p

## Development

Install and run:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Build output is written to ../Backend/public/dist.

Lint:

```bash
npm run lint
```

PowerShell note: if npm is blocked, use npm.cmd.
