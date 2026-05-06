import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import { spawnSync } from 'child_process'

const WINDOWS_FFMPEG_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

function cleanupIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
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
          return reject(new Error('Failed to download ffmpeg: too many redirects.'))
        }
        const nextUrl = new URL(location, url).toString()
        return resolve(downloadToFile(nextUrl, downloadPath, redirectCount + 1))
      }

      if (statusCode !== 200) {
        response.resume()
        cleanupIfExists(downloadPath)
        return reject(new Error(`Failed to download ffmpeg: HTTP ${statusCode}.`))
      }

      const file = fs.createWriteStream(downloadPath)
      response.pipe(file)

      file.on('finish', () => {
        file.close()
        resolve(downloadPath)
      })

      file.on('error', (err) => {
        file.destroy()
        cleanupIfExists(downloadPath)
        reject(new Error(`Failed to write ffmpeg download: ${err.message}`))
      })
    })

    request.on('error', (err) => {
      cleanupIfExists(downloadPath)
      reject(new Error(`Failed to download ffmpeg: ${err.message}`))
    })
  })
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function findFileRecursive(rootDir, filename) {
  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !fs.existsSync(current)) continue

    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(entryPath)
      } else if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return entryPath
      }
    }
  }

  return null
}

export function isFfmpegAvailable() {
  const isWindows = process.platform === 'win32'
  const cmd = isWindows ? 'where' : 'which'
  const result = spawnSync(cmd, ['ffmpeg'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0
}

export function getBundledFfmpegLocation(dataDirAbs) {
  const ffmpegDir = path.resolve(dataDirAbs, 'ffmpeg')
  const ffmpegExe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const ffmpegPath = path.resolve(ffmpegDir, ffmpegExe)

  if (fs.existsSync(ffmpegPath)) {
    return ffmpegDir
  }

  return null
}

export async function downloadPortableFfmpeg(dataDirAbs) {
  if (process.platform !== 'win32') {
    throw new Error('Portable ffmpeg auto-download is currently supported only on Windows.')
  }

  const ffmpegDir = path.resolve(dataDirAbs, 'ffmpeg')
  ensureDir(ffmpegDir)

  const bundled = getBundledFfmpegLocation(dataDirAbs)
  if (bundled) {
    console.log(`[VOOTED] ffmpeg already present: ${path.resolve(bundled, 'ffmpeg.exe')}`)
    return bundled
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vooted-ffmpeg-'))
  const zipPath = path.join(tempRoot, 'ffmpeg.zip')
  const extractDir = path.join(tempRoot, 'extract')
  ensureDir(extractDir)

  try {
    console.log(`[VOOTED] Downloading ffmpeg from: ${WINDOWS_FFMPEG_ZIP_URL}`)
    await downloadToFile(WINDOWS_FFMPEG_ZIP_URL, zipPath)

    const expand = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', 'Expand-Archive', '-Path', zipPath, '-DestinationPath', extractDir, '-Force'],
      { encoding: 'utf-8' },
    )

    if (expand.status !== 0) {
      const details = String(expand.stderr || expand.stdout || '').trim()
      throw new Error(`Could not extract ffmpeg archive. ${details}`)
    }

    const sourceFfmpeg = findFileRecursive(extractDir, 'ffmpeg.exe')
    if (!sourceFfmpeg) {
      throw new Error('ffmpeg.exe not found inside downloaded archive.')
    }

    const sourceFfprobe = findFileRecursive(extractDir, 'ffprobe.exe')
    const targetFfmpeg = path.resolve(ffmpegDir, 'ffmpeg.exe')
    const targetFfprobe = path.resolve(ffmpegDir, 'ffprobe.exe')

    fs.copyFileSync(sourceFfmpeg, targetFfmpeg)
    if (sourceFfprobe) {
      fs.copyFileSync(sourceFfprobe, targetFfprobe)
    }

    console.log(`[VOOTED] Downloaded portable ffmpeg to: ${targetFfmpeg}`)
    return ffmpegDir
  } finally {
    cleanupIfExists(zipPath)
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      // No-op: temp cleanup is best-effort.
    }
  }
}

export async function ensureFfmpegAvailable(dataDirAbs) {
  const bundled = getBundledFfmpegLocation(dataDirAbs)
  if (bundled) {
    return bundled
  }

  if (isFfmpegAvailable()) {
    console.log('[VOOTED] Found ffmpeg on system PATH')
    return null
  }

  if (process.platform !== 'win32') {
    console.warn('[VOOTED] ffmpeg not found and auto-download is not available on this OS.')
    return null
  }

  try {
    return await downloadPortableFfmpeg(dataDirAbs)
  } catch (err) {
    console.warn(`[VOOTED] ffmpeg setup failed: ${err?.message || err}`)
    return null
  }
}
