# VOOTED Backend

Fastify backend for VOOTED. It handles runtime setup, job queue orchestration, yt-dlp execution, settings persistence, and serving the built frontend.

## Responsibilities

- First-run setup API and runtime bootstrap
- YouTube VOD preview/queue/job lifecycle APIs
- Queue controls (pause/start), job cancel/requeue/delete
- Channel Streams preview and bulk queue APIs
- Settings APIs for app/logging/downloader/cookies
- Frontend static file hosting from public/dist
- App shutdown endpoint

## Run

```bash
npm install
npm run dev
```

Production:

```bash
npm start
```

PowerShell note: use npm.cmd if npm is blocked.

## Runtime files

VOOTED uses:

- vooted.runtime.json: runtime state and user-facing settings
- config.json: server defaults derived from config.example.json
- data/youtube-jobs.json: persisted queue/jobs

## Runtime config highlights

Current app-level runtime keys:

- app.port
- app.auto_open_browser
- app.default_channel_url

Logging keys surfaced in settings:

- logging.message.log_to_file
- logging.request.log_to_file

SQL/sequelize logging is kept in schema for compatibility but no longer exposed in user settings UI for portable mode.

## Settings API

- GET /api/settings
- PATCH /api/settings

Returned app payload includes:

- port
- auto_open_browser
- default_channel_url

PATCH supports partial updates for:

- app.port
- app.auto_open_browser
- app.default_channel_url
- logging.message_log_to_file
- logging.request_log_to_file
- downloader.yt_dlp_command

## VOD and queue API

- GET /api/vod/meta
- POST /api/vod/preview
- GET /api/vod/jobs
- GET /api/vod/jobs/:id
- POST /api/vod/jobs
- POST /api/vod/jobs/:id/cancel
- POST /api/vod/jobs/:id/resume
- POST /api/vod/jobs/:id/requeue
- DELETE /api/vod/jobs/:id
- POST /api/vod/queue/pause
- POST /api/vod/queue/start

## Channel Streams API

- POST /api/vod/channel/streams/preview
- POST /api/vod/channel/streams/queue

## Quality presets

Backend preset map includes:

- best (up to 1440p60)
- 1080p (up to 60fps)
- 1080p30
- 720p (up to 60fps)
- 720p30
- 480p

## Shutdown

- POST /api/shutdown

Endpoint returns response and then exits process. Frontend uses this for Close App flow.
