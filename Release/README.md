# VOOTED Release

Portable executables for VOOTED — YouTube VOD downloader. Drop the binary for your OS into a folder, run it, and the dashboard opens in your browser.

## Contents

| Binary                          | Platform                                          | Size  |
|---------------------------------|---------------------------------------------------|-------|
| `VOOTED-win64-1.0.4.exe`        | Windows x64 (Windows 10 / 11)                     | 59 MB |
| `VOOTED-linux-x64-1.0.4`        | Linux x64 (Ubuntu, Debian, Fedora, Arch, …)       | 72 MB |
| `VOOTED-linux-arm64-1.0.4`      | Linux ARM64 (Raspberry Pi 4/5, Apple Silicon)     | 62 MB |
| `VOOTED.exe`                    | Legacy Windows build (kept for backwards compat)  | 59 MB |

Each binary is fully self-contained — bundled Node.js runtime + complete VOOTED backend + the frontend dashboard. The external runtime dependencies are `yt-dlp` (the downloader) and `ffmpeg` (used by yt-dlp to merge / remux the final mp4). On Windows, **both can be auto-provisioned in portable mode** during first-run setup; on Linux you currently still need to install ffmpeg yourself (yt-dlp portable still works).

## Quick Start

### Windows

1. Double-click `VOOTED-win64-1.0.4.exe` — a terminal window opens and your default browser launches automatically.
2. First time only: a setup card appears asking you to confirm the folder and your VOD save location. Click **Confirm & Start VOOTED**.
3. Paste a YouTube URL into the dashboard, click **Queue download**, and watch it run.
4. Close VOOTED via the **✕ Close App** button in the top nav.

### Linux (x64 or ARM64)

```bash
# Make it executable (one-time after copying)
chmod +x VOOTED-linux-x64-1.0.4    # or VOOTED-linux-arm64-1.0.4

# Run it
./VOOTED-linux-x64-1.0.4

# Or skip the browser auto-launch (useful for headless servers)
VOOTED_NO_BROWSER=1 ./VOOTED-linux-x64-1.0.4
```

The first run shows the setup card in your browser at `http://localhost:8111` (or whichever port VOOTED bound to — check the terminal output if 8111 was busy).

## System Requirements

- **Windows**: Windows 10 or 11, x64.
- **Linux x64**: Any reasonably modern distro with glibc ≥ 2.28 (Ubuntu 20.04+, Debian 11+, Fedora 32+, Arch — basically anything from 2020 onward).
- **Linux ARM64**: Raspberry Pi 4/5 running 64-bit Raspberry Pi OS or Ubuntu, Apple Silicon Macs running Linux in a VM, or any ARM64 Linux machine with glibc ≥ 2.28.
- **Internet connection** for YouTube access.
- **`yt-dlp`** — VOOTED shells out to it for downloads.
  - Windows: pick **Download portable yt-dlp** in the first-run setup card, or install yourself from [yt-dlp/yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) or `choco install yt-dlp`
  - Linux: `pip install --user yt-dlp` or check your distro's package manager (`apt install yt-dlp`, `pacman -S yt-dlp`, etc.)
- **`ffmpeg`** — yt-dlp uses it to merge the chosen video / audio streams into the final mp4.
  - Windows: VOOTED auto-downloads a portable build (from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)) when you pick **Portable** or **Auto** in setup and no system ffmpeg is found. Manual install also works (`choco install ffmpeg`).
  - Linux: install via your package manager (`apt install ffmpeg`, `pacman -S ffmpeg`, …). Auto-provisioning isn't shipped for Linux yet.

If yt-dlp isn't on PATH and you skipped the portable option, the dashboard shows a "Not found" status and downloads will fail; configure the full path under **Settings → Downloader → yt-dlp command**.

## Cookie auth (for age-gated, members-only, region-locked videos)

Some YouTube videos require an authenticated session. After first-run setup, go to **Settings → Cookie auth** and use one of two methods:

1. **From file (extension export)** — install "Get cookies.txt LOCALLY" (Chrome/Edge/Brave) or "cookies.txt" (Firefox) in your browser, sign in to YouTube, export the cookies file, and import it into VOOTED. The settings page has a 5-step inline guide with direct links to each store.
2. **Paste from DevTools** — no extension needed. Open `youtube.com` while signed in, press F12 → Network → click any request → copy the value of the `Cookie:` request header → paste it into VOOTED. Works for most downloads but is slightly less complete than the file path.

## Troubleshooting

### "Port 8111 was in use" warning banner
VOOTED auto-retried on the next port (8112, 8113, …). The banner shows the actual bound port. No action needed — your downloads work fine. Dismiss the banner and continue.

### Terminal window opens but browser doesn't
Some headless or locked-down systems block auto-launch. Open your browser manually to `http://localhost:8111` (or whichever port the terminal logged).

### VOD downloads fail with auth errors
Configure cookie auth via **Settings → Cookie auth** — see the section above. yt-dlp can't access age-gated or members-only content without a cookies file.

### "ffmpeg not found" or downloads stall at the merge step
If yt-dlp can pull video + audio streams but fails to remux to mp4, ffmpeg is missing. On Windows, re-run setup and pick **Portable** to auto-download it. On Linux/macOS, install ffmpeg via your package manager (`apt install ffmpeg`, `brew install ffmpeg`, etc.). VOOTED stores the active ffmpeg path under `downloader.ffmpeg_location` in `vooted.runtime.json`; clearing that field forces a re-detect on next start.

### Linux: "Permission denied" when running the binary
Linux binaries need the execute bit. Run `chmod +x VOOTED-linux-x64-1.0.4` once, then `./VOOTED-linux-x64-1.0.4`. This is needed after copying via SCP or extracting from a zip — most filesystems don't preserve the execute bit on transfer.

### Linux: binary won't start, complains about glibc
The binaries are built against glibc ≥ 2.28. Very old distros (Ubuntu 18.04, Debian 9 / 10, RHEL 7) won't run them. Upgrade or build from source.

### macOS support
Not officially shipped. macOS binaries would need Apple Developer ID code-signing for distribution outside dev machines. If you have macOS, run from source with `npm start` in the `Backend/` directory.

## Configuration

After first run, edit settings via the **Settings** page in the dashboard, or directly in `vooted.runtime.json` next to the EXE:

- Default port (default: `8111`) — restart required after change
- Auto-open browser on launch
- Default channel URL (used to prefill Channel Streams)
- Logging to file (message / request)
- Custom yt-dlp command path
- Active cookie file

## Quality presets and FPS

VOOTED quality options include explicit FPS behavior:

- Best available (up to 1440p60)
- 1080p (up to 60fps)
- 1080p 30fps
- 720p (up to 60fps)
- 720p 30fps
- 480p

The `data/` folder next to the EXE holds the job database and any cookie files. Back it up if you want to preserve job history across moves; delete it to reset to a clean state.

## Closing VOOTED

Click **✕ Close App** in the top nav. A confirmation modal appears that probes the server first — if VOOTED is alive it stops the local server, if it's already gone it just closes the tab. Either way the EXE process exits cleanly.

If the modal fails, you can also stop the EXE from your OS:
- **Windows**: close the terminal window, or `taskkill /F /IM VOOTED-win64-1.0.4.exe`
- **Linux**: `Ctrl+C` in the terminal, or `pkill -f VOOTED-linux`

## Building from source

If you want to build these binaries yourself, see [CROSS_PLATFORM_BUILD.md](../CROSS_PLATFORM_BUILD.md) at the repo root.
