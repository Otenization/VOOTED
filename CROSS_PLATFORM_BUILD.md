# Cross-platform builds

VOOTED ships as a portable, single-file executable for Windows and Linux. This doc covers building all three target binaries from a single host.

## Targets

| Target key      | pkg flag              | Output filename pattern                | Use case                           |
|-----------------|-----------------------|----------------------------------------|------------------------------------|
| `win64`         | `node20-win-x64`      | `VOOTED-win64-<version>.exe`           | Windows users                      |
| `linux-x64`     | `node20-linux-x64`    | `VOOTED-linux-x64-<version>`           | Ubuntu, Debian, Fedora, etc.       |
| `linux-arm64`   | `node20-linux-arm64`  | `VOOTED-linux-arm64-<version>`         | Raspberry Pi, Apple Silicon native |

All three are produced in `Release/` next to whatever host you build from.

## TL;DR

```bash
cd Backend
npm run build:all
```

That builds all three targets from any host (Windows, Linux, macOS). Output lands in `../Release/`.

## Why this works without WSL2 or Docker

Most cross-platform `pkg` guides tell you to use WSL2 or Docker for Linux builds from Windows. **You don't need either for VOOTED.**

The reason WSL2/Docker is usually required: projects with native modules (anything with a `.node` binary — `better-sqlite3`, `sharp`, `bcrypt`, etc.) have to be compiled on the *target* OS. pkg can't cross-compile a Linux `.node` from Windows source.

**VOOTED has zero native modules.** Our deps are all pure JavaScript:

- `fastify`, `@fastify/cors`, `@fastify/static`, `@fastify/websocket`, `fastify-plugin`
- `sequelize` (DB-disabled by default; only `pg` is loaded if used)
- `pg` — pure-JS, no `pg-native`
- `node-cron`, `iso-639-1`

So `pkg-fetch` downloads the prebuilt Node binary for each target platform, combines it with our shared esbuild bundle, and writes the resulting Linux ELF / Windows PE file. The host OS doesn't matter.

If a future dependency adds a native module, this stops being true and the WSL2/Docker setup will be needed. Audit `Backend/package.json` for any new deps with `.node` binaries before merging.

## Build commands

Run all from the `Backend/` directory.

```bash
# All three targets (Windows + both Linux flavours)
npm run build:all

# One target at a time
npm run build:windows
npm run build:linux
npm run build:linux-arm

# Or invoke the script directly with explicit targets
node build-multi-platform.cjs --target linux-x64 --target linux-arm64
```

Each invocation:

1. Runs `esbuild` once to produce `Backend/dist-server/bundle.cjs` (shared across targets).
2. Runs `pkg` per target with the right `--targets` flag and `-c package.json` so the bundled assets (`public/dist/**`) get embedded.
3. Writes output to `Release/VOOTED-<target>-<version><extension>`.
4. Prints a summary table at the end (✓ / ✗ per target with file size).

If one target fails the script keeps going, reports which succeeded, and exits non-zero. So `npm run build:all` is safe to use even if you only sometimes care about one target.

## Output

Binaries land in `Release/` at the repo root with version + target in the filename:

```
Release/
├── VOOTED-win64-1.0.0.exe       # ~62 MB
├── VOOTED-linux-x64-1.0.0       # ~67 MB
└── VOOTED-linux-arm64-1.0.0     # ~67 MB
```

The original `npm run package` command still works — it produces `Release/VOOTED.exe` (no version suffix) for backwards compatibility.

## Runtime tools (yt-dlp + ffmpeg)

VOOTED shells out to `yt-dlp` for downloads and `ffmpeg` for the final mp4 merge/remux. Both are runtime dependencies, not bundled into the pkg snapshot.

| Tool   | Windows portable auto-provisioning | Other OSes |
|--------|------------------------------------|------------|
| yt-dlp | ✓ Single-file `.exe` downloaded into `data/yt-dlp/` when user picks Portable / Auto in setup. | Manual install (`apt install yt-dlp`, `pip install --user yt-dlp`, `brew install yt-dlp`, …). |
| ffmpeg | ✓ `ffmpeg-release-essentials.zip` from gyan.dev downloaded and extracted into `data/ffmpeg/` when user picks Portable / Auto **and no system ffmpeg is found**. | Not auto-provisioned yet — manual install required (`apt install ffmpeg`, `brew install ffmpeg`, etc.). yt-dlp portable still works on its own; only the merge step needs ffmpeg. |

The bundled-tool location is persisted in `vooted.runtime.json` under `downloader.yt_dlp_command` and `downloader.ffmpeg_location`. yt-dlp gets `--ffmpeg-location <path>` whenever `ffmpeg_location` is configured and the file exists; if the path is stale (e.g., user deleted `data/`) the flag is silently dropped so yt-dlp falls back to PATH.

If a future portable ffmpeg story lands for Linux/macOS, the only work is teaching `ffmpeg-manager.service.js` how to fetch + extract per-OS archives — the runtime config plumbing and the yt-dlp wiring are already platform-agnostic.

## Testing the binaries

The build script can produce all three binaries from a single host, **but it can't run them**. You have to smoke-test each on its target OS before shipping.

### Windows

```powershell
cd Release
.\VOOTED-win64-1.0.0.exe
# Browser opens to localhost:8111. Confirm setup card appears.
```

### Linux x64 (Ubuntu / Debian / Fedora / Arch)

```bash
cd Release
chmod +x VOOTED-linux-x64-1.0.0
./VOOTED-linux-x64-1.0.0
# Server starts on 8111. xdg-open opens default browser if available.
# Headless: set VOOTED_NO_BROWSER=1 and curl localhost:8111/api/health.
```

### Linux ARM64 (Raspberry Pi / Apple Silicon)

```bash
chmod +x VOOTED-linux-arm64-1.0.0
./VOOTED-linux-arm64-1.0.0
```

Same flow as x64. On Apple Silicon, this runs natively (not under Rosetta).

### Quick health check (any platform)

```bash
curl -sS http://localhost:8111/api/health
# Expected: {"ok":true,"service":"VOOTED API","timestamp":"..."}
```

## CI / GitHub Actions (future-proof)

If you want automated runtime verification on every release, a workflow at `.github/workflows/release.yml` along these lines does it:

```yaml
name: Release builds
on:
  push:
    tags: ['v*']
jobs:
  build:
    strategy:
      matrix:
        host: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.host }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
        working-directory: Backend
      - run: npm run build:all
        working-directory: Backend
      - uses: actions/upload-artifact@v4
        with:
          name: vooted-${{ matrix.host }}
          path: Release/VOOTED-*
```

Builds on both `ubuntu-latest` and `windows-latest` give you native-platform smoke-test confidence (each runner can actually execute its own binaries).

## Troubleshooting

### `pkg-fetch` downloads fail behind a corporate proxy

`pkg-fetch` honours `HTTPS_PROXY` / `https_proxy`. Set it before running, or download the binaries manually into `~/.pkg-cache/v3.x/` matching the expected filename (`fetched-v20.<patch>-<platform>-<arch>`).

### "Cannot find module" at runtime

The pkg snapshot only includes files reachable from the bundle's `require` chain. If you add a runtime-loaded asset (config file, JSON resource), list it under `pkg.assets` in `Backend/package.json`. Currently we only bundle `public/dist/**/*` (the frontend).

### Linux binary refuses to run with "permission denied"

Linux outputs aren't marked executable when copied across filesystems (e.g. via SCP from Windows). Run `chmod +x VOOTED-linux-x64-<version>` before launching.

### EXE still produces `Release/VOOTED.exe`

That's the legacy `npm run package` path. It still works for backwards compatibility but doesn't include a version suffix. Use `npm run build:windows` or `npm run build:all` for the new naming.

### `spawn UNKNOWN` when building `linux-arm64` from an x64 host

pkg's "fabricator" step pre-compiles JS to V8 bytecode by spawning a Node binary of the **target CPU arch**. When the host arch differs from the target arch (e.g. Windows-x64 building `linux-arm64`), the host can't execute the ARM64 fabricator and pkg dies with `Error: spawn UNKNOWN`.

The build script auto-detects this case and adds `--no-bytecode --public` to the pkg invocation — those flags skip the bytecode-compile step entirely, so cross-arch builds just work. The cost is a tiny startup-time penalty (Node parses source instead of loading pre-compiled bytecode) that's invisible in practice for a small server bundle.

If you're building on an actual ARM64 host (Apple Silicon, Raspberry Pi), the script skips the workaround automatically and you get full bytecode optimization. Same logic applies if a future macOS-arm64 target is added.

### Native module added by accident

If a future dep pulls in a `.node` binary, the cross-built Linux/Windows output will load the wrong-OS native file at runtime and crash. Audit:

```bash
find Backend/node_modules -name '*.node' 2>/dev/null
```

If anything appears, you're back to the WSL2/Docker workflow per target.

## Files

- `Backend/build.cjs` — esbuild bundle script (shared across targets).
- `Backend/build-multi-platform.cjs` — multi-target loop calling pkg per target.
- `Backend/package.json#scripts` — `build:all`, `build:windows`, `build:linux`, `build:linux-arm`.
- `Release/VOOTED-<target>-<version><ext>` — output binaries.
