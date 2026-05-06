import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createHash } from 'crypto'
import { spawn } from 'child_process'

const DEFAULT_UPDATE_REPO = process.env.VOOTED_UPDATE_REPO || 'Otenization/VOOTED'

function parseSemver(input) {
  const clean = String(input || '').trim().replace(/^v/i, '')
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    raw: clean,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function isNewerVersion(latest, current) {
  const a = parseSemver(latest)
  const b = parseSemver(current)
  if (!a || !b) return false
  if (a.major !== b.major) return a.major > b.major
  if (a.minor !== b.minor) return a.minor > b.minor
  return a.patch > b.patch
}

function getCurrentVersion() {
  if (process.pkg) {
    const base = path.basename(process.execPath)
    const match = base.match(/(\d+\.\d+\.\d+)/)
    if (match) return match[1]
  }
  return process.env.VOOTED_VERSION || '0.0.0'
}

function getAssetPattern() {
  if (process.platform === 'win32') return /^VOOTED-win64-.*\.exe$/i
  if (process.platform === 'linux' && process.arch === 'x64') return /^VOOTED-linux-x64-/i
  if (process.platform === 'linux' && process.arch === 'arm64') return /^VOOTED-linux-arm64-/i
  return null
}

async function fetchLatestRelease(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      'User-Agent': 'VOOTED-Updater',
      Accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch latest release (${response.status})`)
  }

  return response.json()
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', resolve)
    input.on('error', reject)
  })
  return hash.digest('hex')
}

async function downloadAsset(url, destinationPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'VOOTED-Updater',
      Accept: 'application/octet-stream',
    },
  })

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download update asset (${response.status})`)
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  const output = fs.createWriteStream(destinationPath)
  await pipeline(Readable.fromWeb(response.body), output)
}

function createWindowsUpdaterScript({ scriptPath, targetPath, downloadedPath, backupPath }) {
  const lines = [
    '@echo off',
    'setlocal',
    `set "TARGET=${targetPath}"`,
    `set "NEWFILE=${downloadedPath}"`,
    `set "BACKUP=${backupPath}"`,
    '',
    'for /l %%i in (1,1,60) do (',
    '  if not exist "%TARGET%" goto swap',
    '  move /Y "%TARGET%" "%BACKUP%" >nul 2>&1',
    '  if not errorlevel 1 goto swap',
    '  timeout /t 1 /nobreak >nul',
    ')',
    'goto fail',
    '',
    ':swap',
    'move /Y "%NEWFILE%" "%TARGET%" >nul 2>&1',
    'if errorlevel 1 goto fail',
    'start "" "%TARGET%"',
    'timeout /t 2 /nobreak >nul',
    'if exist "%BACKUP%" del /f /q "%BACKUP%" >nul 2>&1',
    'del /f /q "%~f0"',
    'exit /b 0',
    '',
    ':fail',
    'exit /b 1',
  ]

  fs.writeFileSync(scriptPath, `${lines.join('\r\n')}\r\n`, 'utf-8')
}

function createLinuxUpdaterScript({ scriptPath, targetPath, downloadedPath, backupPath }) {
  const script = `#!/usr/bin/env bash
set -e
TARGET="${targetPath}"
NEWFILE="${downloadedPath}"
BACKUP="${backupPath}"

for i in $(seq 1 60); do
  if [ ! -f "$TARGET" ]; then
    break
  fi
  if mv -f "$TARGET" "$BACKUP" 2>/dev/null; then
    break
  fi
  sleep 1
done

mv -f "$NEWFILE" "$TARGET"
chmod +x "$TARGET"
nohup "$TARGET" >/dev/null 2>&1 &
sleep 2
rm -f "$BACKUP"
rm -f "$0"
`
  fs.writeFileSync(scriptPath, script, 'utf-8')
  fs.chmodSync(scriptPath, 0o755)
}

function launchUpdaterScript(scriptPath) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', scriptPath], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  spawn('bash', [scriptPath], { detached: true, stdio: 'ignore' }).unref()
}

export async function getSelfUpdateStatus() {
  const currentVersion = getCurrentVersion()
  const repo = DEFAULT_UPDATE_REPO
  const latest = await fetchLatestRelease(repo)
  const tag = String(latest?.tag_name || '').trim()
  const latestVersion = tag.replace(/^v/i, '')
  const pattern = getAssetPattern()
  const assets = Array.isArray(latest?.assets) ? latest.assets : []
  const asset = pattern ? assets.find((entry) => pattern.test(String(entry?.name || ''))) : null

  return {
    repo,
    currentVersion,
    latestTag: tag,
    latestVersion,
    updateAvailable: Boolean(asset) && isNewerVersion(latestVersion, currentVersion),
    platformSupported: Boolean(pattern),
    assetName: asset?.name || '',
    assetUrl: asset?.browser_download_url || '',
    releaseUrl: latest?.html_url || '',
    publishedAt: latest?.published_at || null,
  }
}

export async function applySelfUpdate() {
  if (!process.pkg) {
    throw new Error('Self-update is only supported in the packaged VOOTED app.')
  }

  const status = await getSelfUpdateStatus()
  if (!status.platformSupported) {
    throw new Error(`This platform is not supported for auto-update (${process.platform}/${process.arch}).`)
  }
  if (!status.updateAvailable || !status.assetUrl || !status.assetName) {
    throw new Error('No newer release found.')
  }

  const appDir = path.dirname(process.execPath)
  const updatesDir = path.join(appDir, 'updates')
  const downloadedPath = path.join(updatesDir, status.assetName)
  const targetPath = process.execPath
  const backupPath = `${targetPath}.old`

  await downloadAsset(status.assetUrl, downloadedPath)

  const latest = await fetchLatestRelease(status.repo)
  const asset = (Array.isArray(latest?.assets) ? latest.assets : []).find((entry) => entry?.name === status.assetName)
  const digestRaw = String(asset?.digest || '').trim()
  if (digestRaw.startsWith('sha256:')) {
    const expected = digestRaw.slice('sha256:'.length).toLowerCase()
    const actual = (await sha256File(downloadedPath)).toLowerCase()
    if (actual !== expected) {
      throw new Error('Downloaded update failed SHA256 verification.')
    }
  }

  const scriptPath = process.platform === 'win32'
    ? path.join(updatesDir, 'apply-update.cmd')
    : path.join(updatesDir, 'apply-update.sh')

  if (process.platform === 'win32') {
    createWindowsUpdaterScript({ scriptPath, targetPath, downloadedPath, backupPath })
  } else {
    createLinuxUpdaterScript({ scriptPath, targetPath, downloadedPath, backupPath })
  }

  launchUpdaterScript(scriptPath)

  return {
    ...status,
    message: `Update downloaded (${status.assetName}). Restarting into ${status.latestTag}...`,
  }
}
