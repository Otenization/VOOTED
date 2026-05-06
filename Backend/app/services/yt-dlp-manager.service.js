import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import https from 'https'

function cleanupDownloadTarget(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

function downloadToFile(url, downloadPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const statusCode = response.statusCode || 0
      const location = response.headers.location

      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        response.resume()
        if (redirectCount >= 5) {
          return reject(new Error('Failed to download yt-dlp: too many redirects.'))
        }
        const nextUrl = new URL(location, url).toString()
        return resolve(downloadToFile(nextUrl, downloadPath, redirectCount + 1))
      }

      if (statusCode !== 200) {
        response.resume()
        cleanupDownloadTarget(downloadPath)
        return reject(
          new Error(
            `Failed to download yt-dlp: HTTP ${statusCode}. Ensure yt-dlp is installed manually.`,
          ),
        )
      }

      const file = fs.createWriteStream(downloadPath)
      response.pipe(file)

      file.on('finish', () => {
        file.close()
        resolve(downloadPath)
      })

      file.on('error', (err) => {
        file.destroy()
        cleanupDownloadTarget(downloadPath)
        reject(new Error(`Failed to write yt-dlp download: ${err.message}`))
      })
    })

    request.on('error', (err) => {
      cleanupDownloadTarget(downloadPath)
      reject(
        new Error(
          `Failed to download yt-dlp: ${err.message}. Ensure yt-dlp is installed manually or check your internet connection.`,
        ),
      )
    })
  })
}

/**
 * Detects the current OS and architecture.
 * Returns { os: 'windows' | 'darwin' | 'linux', arch: 'x64' | 'arm64' | 'x32' }
 */
export function detectOsArch() {
  const os = process.platform
  const arch = process.arch

  let normalizedOs = 'linux'
  if (os === 'win32') normalizedOs = 'windows'
  if (os === 'darwin') normalizedOs = 'darwin'

  let normalizedArch = 'x64'
  if (arch === 'arm64') normalizedArch = 'arm64'
  if (arch === 'x32' || arch === 'ia32') normalizedArch = 'x32'

  return { os: normalizedOs, arch: normalizedArch }
}

/**
 * Checks if yt-dlp is available on the system PATH.
 * Returns true if yt-dlp command can be executed.
 */
export function isYtDlpAvailable() {
  const isWindows = process.platform === 'win32'
  const cmd = isWindows ? 'where' : 'which'
  const result = spawnSync(cmd, ['yt-dlp'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0
}

/**
 * Gets the release filename for yt-dlp based on OS and arch.
 * Example: yt-dlp_windows_x64, yt-dlp (macOS), yt-dlp (Linux)
 */
function getYtDlpReleaseFilename(os, arch) {
  // yt-dlp release naming convention:
  // Windows: yt-dlp_windows (x64 only)
  // macOS: yt-dlp_macos (arm64) or yt-dlp_macos (x64)
  // Linux: yt-dlp (universal executable)
  // See: https://github.com/yt-dlp/yt-dlp/releases

  if (os === 'windows') {
    return 'yt-dlp.exe'
  }

  if (os === 'darwin') {
    if (arch === 'arm64') {
      return 'yt-dlp_macos_arm64'
    }
    return 'yt-dlp_macos'
  }

  // Linux or other
  return 'yt-dlp'
}

/**
 * Downloads yt-dlp from GitHub releases.
 * Returns the path to the downloaded executable.
 */
export async function downloadYtDlp(dataDirAbs) {
  const { os, arch } = detectOsArch()
  const filename = getYtDlpReleaseFilename(os, arch)

  // Ensure yt-dlp subdirectory exists
  const ytDlpDir = path.resolve(dataDirAbs, 'yt-dlp')
  if (!fs.existsSync(ytDlpDir)) {
    fs.mkdirSync(ytDlpDir, { recursive: true })
  }

  const downloadPath = path.resolve(ytDlpDir, filename)

  // If already downloaded, skip
  if (fs.existsSync(downloadPath)) {
    console.log(`[VOOTED] yt-dlp already present: ${downloadPath}`)
    return downloadPath
  }

  // Get the latest release URL
  const releaseUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${filename}`

  console.log(`[VOOTED] Downloading yt-dlp from: ${releaseUrl}`)

  await downloadToFile(releaseUrl, downloadPath)

  if (os !== 'windows') {
    try {
      fs.chmodSync(downloadPath, 0o755)
    } catch (err) {
      console.warn(`[VOOTED] Could not make yt-dlp executable: ${err.message}`)
    }
  }

  console.log(`[VOOTED] Downloaded yt-dlp to: ${downloadPath}`)
  return downloadPath
}

/**
 * Ensures yt-dlp is available, either via system PATH or bundled.
 * If not found on system and download fails, returns null.
 * Otherwise returns the command to use for yt-dlp.
 */
export async function ensureYtDlpAvailable(dataDirAbs) {
  // First check if system yt-dlp is available
  if (isYtDlpAvailable()) {
    console.log('[VOOTED] Found yt-dlp on system PATH')
    return 'yt-dlp'
  }

  // Try to download bundled yt-dlp
  console.log('[VOOTED] System yt-dlp not found, attempting to download bundled version...')

  try {
    const downloadPath = await downloadYtDlp(dataDirAbs)
    console.log(`[VOOTED] Bundled yt-dlp ready: ${downloadPath}`)

    // Return the path to the bundled executable
    return downloadPath
  } catch (err) {
    console.error(`[VOOTED] Failed to download yt-dlp: ${err.message}`)
    return null
  }
}
