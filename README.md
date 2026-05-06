# VOOTED

VOOTED (Video on Ote demand) is a portable local web app for downloading your own YouTube VODs.

It uses a Fastify backend and a React + Vite frontend, runs on localhost, and is designed for streamer-friendly setup without command-line prompts.

## What you get

- GUI first-run setup flow (no CLI wizard)
- Job queue with live status, progress, speed, and ETA
- Queue controls (pause/start), per-job cancel/delete, and canceled-job requeue
- Channel Streams bulk queue workflow
- Runtime Settings page for app, logging, downloader, and cookie auth
- Cross-platform build pipeline for Windows and Linux binaries

## Project structure

```text
Backend/
  app/
    routes/        API routes (/api/setup, /api/vod, /api/settings, /api/shutdown)
    services/      runtime bootstrap, job queue, yt-dlp orchestration
    plugins/       Fastify plugins
  public/dist/     built frontend assets
  config.example.json
  server.js

Frontend/
  src/
    pages/         Setup, Home, Job Detail, Channel Streams, Settings
    components/    shared UI components (including Modal)
    lib/           typed API client + config helpers
    hooks/         polling hooks

Release/           packaged binaries and release notes
run.bat            root launcher for Windows
```

## Core behavior

1. App starts and opens browser (unless disabled).
2. If runtime file is missing, Setup page appears.
3. Confirm setup and VOOTED creates runtime files in-place.
4. Dashboard and tools become available immediately (no restart needed).

Runtime files are created in the app folder after setup confirmation:

- vooted.runtime.json
- config.json
- data/youtube-jobs.json
- logs/
- Youtube_VOD/

## Settings

Settings are managed in the UI at /settings and persisted through /api/settings.

App settings include:

- Default port
- Auto-open browser on launch
- Default channel URL (used to prefill Channel Streams)

Logging settings include:

- Message log to file
- HTTP request log to file

Note: SQL query log toggle is intentionally removed from the user UI because the portable flow runs with database disabled.

Downloader settings include:

- yt-dlp command/path
- ffmpeg location (auto-populated on Windows when portable ffmpeg is provisioned; manually editable in `vooted.runtime.json` under `downloader.ffmpeg_location`)

Cookie auth supports manual import:

- Import cookies.txt file
- Paste Cookie header from browser DevTools

## Download quality presets

VOOTED supports quality presets with FPS caps:

- Best available (up to 1440p60)
- 1080p (up to 60fps)
- 1080p 30fps
- 720p (up to 60fps)
- 720p 30fps
- 480p

## Local development

Prerequisites:

- Node.js
- yt-dlp available on PATH, or configure the executable in Settings
- ffmpeg available on PATH (used by yt-dlp for merging/remuxing). On Windows, the portable / auto setup flow auto-downloads it; on Linux/macOS install via your package manager (`apt install ffmpeg`, `brew install ffmpeg`, etc.).

Install:

```bash
cd Backend && npm install
cd ../Frontend && npm install
```

Build frontend for backend hosting:

```bash
cd Frontend
npm run build
```

Start backend:

```bash
cd Backend
npm start
```

On Windows from repo root:

```bash
run.bat
```

PowerShell note: if npm is blocked by execution policy, use npm.cmd.

## Packaging

Backend includes packaging scripts for:

- Windows x64
- Linux x64
- Linux ARM64

See CROSS_PLATFORM_BUILD.md for full build and release details.

## Main API surfaces

- GET /api/health
- GET /api/setup/status
- POST /api/setup/complete
- GET /api/vod/meta
- GET /api/vod/jobs
- POST /api/vod/jobs
- POST /api/vod/jobs/:id/cancel
- POST /api/vod/jobs/:id/requeue
- DELETE /api/vod/jobs/:id
- GET /api/settings
- PATCH /api/settings
- GET /api/settings/cookies
- POST /api/settings/cookies/import
- POST /api/settings/cookies/import-paste
- POST /api/settings/cookies/clear
- POST /api/shutdown
