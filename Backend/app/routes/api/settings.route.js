import fs from 'fs'
import path from 'path'
import {
  patchRuntimeConfig,
  updateRuntimeDownloaderConfig,
} from '../../services/runtime-bootstrap.service.js'
import { peekYoutubeJobService } from '../../services/youtube-job.service.js'
import { loadConfig, resetConfigCache } from '../../../lib/utility.js'

// NOTE: auto cookie pull (yt-dlp `--cookies-from-browser` and the CDP / Chrome
// DevTools Protocol path) was removed 2026-05-06 — see AI_CarryOn.md
// "Cookie auth design notes" for why neither approach was reliable enough for
// end users. Manual import is the only supported path. Re-add the auto routes
// from git history (or re-derive) if/when a robust solution is found.

function requireReady(reply) {
  const jobs = peekYoutubeJobService()
  if (!jobs) {
    reply.code(503).send({
      ok: false,
      setup_required: true,
      message: 'First-run setup required. Please complete setup in the browser.',
    })
    return null
  }
  return jobs
}

function syncRuntimeState(fastify, jobs, runtime) {
  jobs.runtime = runtime
  fastify.runtime = runtime

  resetConfigCache()
  const fullConfig = loadConfig()
  if (fastify.config && typeof fastify.config === 'object') {
    Object.assign(fastify.config, fullConfig)
  }
}

function getSettingsPayload(runtimeConfig) {
  return {
    app: {
      port: runtimeConfig?.app?.port ?? 8111,
      auto_open_browser: runtimeConfig?.app?.auto_open_browser !== false,
      default_channel_url: runtimeConfig?.app?.default_channel_url || '',
    },
    logging: {
      message_log_to_file: runtimeConfig?.logging?.message?.log_to_file === true,
      request_log_to_file: runtimeConfig?.logging?.request?.log_to_file === true,
      query_log_to_file: runtimeConfig?.logging?.sequelize?.log_to_file === true,
    },
    downloader: {
      yt_dlp_command: runtimeConfig?.downloader?.yt_dlp_command || 'yt-dlp',
      cookies_file: runtimeConfig?.downloader?.cookies_file || '',
      cookies_from_browser: runtimeConfig?.downloader?.cookies_from_browser || '',
    },
  }
}

function getCookieFileInfo(appDir, runtimeConfig) {
  const relativePath = runtimeConfig?.downloader?.cookies_file || ''
  const browserSource = runtimeConfig?.downloader?.cookies_from_browser || ''
  const absolutePath = relativePath ? path.resolve(appDir, relativePath) : ''

  let exists = false
  let size = 0
  let updatedAt = null

  if (absolutePath && fs.existsSync(absolutePath)) {
    const stat = fs.statSync(absolutePath)
    exists = stat.isFile()
    size = stat.size
    updatedAt = stat.mtime.toISOString()
  }

  return {
    mode: browserSource ? 'browser' : (relativePath ? 'file' : 'none'),
    browser: browserSource,
    relativePath,
    absolutePath,
    exists,
    size,
    updatedAt,
  }
}

function sanitizeCookieFilename(name) {
  const fallback = 'youtube.cookies.txt'
  const safe = String(name || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '')

  if (!safe) return fallback
  if (!safe.endsWith('.txt')) return `${safe}.txt`
  return safe
}

export default async function settingsRoutes(fastify) {
  fastify.get('/', async (_request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return

    return reply.send({
      ok: true,
      data: getSettingsPayload(jobs.runtime.runtimeConfig),
    })
  })

  fastify.patch('/', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return

    const body = request.body || {}
    const currentPort = jobs.runtime.runtimeConfig?.app?.port ?? 8111

    let nextPort = currentPort
    if (body.app?.port !== undefined) {
      nextPort = Number(body.app.port)
      if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
        return reply.code(400).send({ ok: false, message: 'app.port must be an integer between 1 and 65535' })
      }
    }

    const runtime = patchRuntimeConfig((config) => ({
      ...config,
      app: {
        ...(config.app || {}),
        ...(body.app || {}),
        port: nextPort,
        ...(body.app?.default_channel_url !== undefined
          ? { default_channel_url: String(body.app.default_channel_url).trim() }
          : {}),
      },
      logging: {
        ...(config.logging || {}),
        message: {
          ...(config.logging?.message || {}),
          ...(body.logging?.message_log_to_file !== undefined
            ? { log_to_file: body.logging.message_log_to_file === true }
            : {}),
        },
        request: {
          ...(config.logging?.request || {}),
          ...(body.logging?.request_log_to_file !== undefined
            ? { log_to_file: body.logging.request_log_to_file === true }
            : {}),
        },
        sequelize: {
          ...(config.logging?.sequelize || {}),
          ...(body.logging?.query_log_to_file !== undefined
            ? { log_to_file: body.logging.query_log_to_file === true }
            : {}),
        },
      },
      downloader: {
        ...(config.downloader || {}),
        ...(body.downloader?.yt_dlp_command
          ? { yt_dlp_command: String(body.downloader.yt_dlp_command).trim() }
          : {}),
      },
    }))

    syncRuntimeState(fastify, jobs, runtime)

    return reply.send({
      ok: true,
      data: {
        settings: getSettingsPayload(runtime.runtimeConfig),
        requiresRestart: nextPort !== currentPort,
      },
    })
  })

  fastify.get('/cookies', async (_request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return

    return reply.send({
      ok: true,
      data: getCookieFileInfo(jobs.runtime.appDir, jobs.runtime.runtimeConfig),
    })
  })

  fastify.post('/cookies/import', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return

    const content = String(request.body?.content || '')
    const filename = sanitizeCookieFilename(request.body?.filename)

    if (!content.trim()) {
      return reply.code(400).send({ ok: false, message: 'Cookie content is required' })
    }

    if (content.length > 5 * 1024 * 1024) {
      return reply.code(400).send({ ok: false, message: 'Cookie file too large (max 5MB)' })
    }

    const appDir = jobs.runtime.appDir
    const cookieDirAbs = path.resolve(appDir, 'data', 'cookies')
    const cookieFileAbs = path.resolve(cookieDirAbs, filename)
    const cookieFileRel = `./data/cookies/${filename}`

    fs.mkdirSync(cookieDirAbs, { recursive: true })
    fs.writeFileSync(cookieFileAbs, content, 'utf-8')

    const runtime = updateRuntimeDownloaderConfig({
      cookies_file: cookieFileRel,
      cookies_from_browser: '',
    })

    syncRuntimeState(fastify, jobs, runtime)

    return reply.send({
      ok: true,
      data: getCookieFileInfo(runtime.appDir, runtime.runtimeConfig),
    })
  })

  // No-extension fallback: user pastes the value of the `Cookie:` request
  // header copied from DevTools → Network tab. We split it into name/value
  // pairs and emit Netscape rows for both .youtube.com and .google.com.
  // The paste loses domain/path/expires metadata, so we use sensible
  // defaults — works for most yt-dlp auth flows but is brittler than a
  // real cookies.txt export.
  fastify.post('/cookies/import-paste', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return

    const header = String(request.body?.header || '').trim()
    if (!header) {
      return reply.code(400).send({ ok: false, message: 'Cookie header is empty.' })
    }
    if (header.length > 16 * 1024) {
      return reply.code(400).send({ ok: false, message: 'Cookie header too large (max 16KB).' })
    }

    const pairs = []
    for (const piece of header.split(/;\s*/)) {
      const trimmed = piece.trim()
      if (!trimmed) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx <= 0) continue
      const name = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (!name) continue
      pairs.push({ name, value })
    }

    if (pairs.length === 0) {
      return reply.code(400).send({
        ok: false,
        message:
          'No cookies found in pasted header. Paste the value of the Cookie: request header from DevTools → Network → any youtube.com request → Headers.',
      })
    }

    const escapeForNetscape = (s) => String(s).replace(/[\t\r\n]/g, ' ')
    const farFutureExpires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 // 1 year
    const lines = [
      '# Netscape HTTP Cookie File',
      '# Generated by VOOTED from a pasted DevTools Cookie header.',
      `# Generated at: ${new Date().toISOString()}`,
      '',
    ]
    // Emit each cookie under both domains since the paste has no per-cookie
    // domain info — yt-dlp will pick whichever it needs.
    for (const { name, value } of pairs) {
      for (const domain of ['.youtube.com', '.google.com']) {
        lines.push(
          [
            domain,
            'TRUE',
            '/',
            'TRUE',
            String(farFutureExpires),
            escapeForNetscape(name),
            escapeForNetscape(value),
          ].join('\t'),
        )
      }
    }
    const content = `${lines.join('\n')}\n`

    const appDir = jobs.runtime.appDir
    const cookieDirAbs = path.resolve(appDir, 'data', 'cookies')
    const filename = 'paste.youtube.cookies.txt'
    const cookieFileAbs = path.resolve(cookieDirAbs, filename)
    const cookieFileRel = `./data/cookies/${filename}`

    fs.mkdirSync(cookieDirAbs, { recursive: true })
    fs.writeFileSync(cookieFileAbs, content, 'utf-8')

    const runtime = updateRuntimeDownloaderConfig({
      cookies_file: cookieFileRel,
      cookies_from_browser: '',
    })

    syncRuntimeState(fastify, jobs, runtime)

    return reply.send({
      ok: true,
      data: {
        ...getCookieFileInfo(runtime.appDir, runtime.runtimeConfig),
        pastedCookieCount: pairs.length,
      },
    })
  })

  fastify.post('/cookies/clear', async (_request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return

    const appDir = jobs.runtime.appDir
    const relativePath = jobs.runtime.runtimeConfig?.downloader?.cookies_file || ''
    if (relativePath) {
      const absolutePath = path.resolve(appDir, relativePath)
      const appRoot = path.resolve(appDir)
      if (absolutePath.startsWith(appRoot) && fs.existsSync(absolutePath)) {
        try {
          fs.unlinkSync(absolutePath)
        } catch {
          // Ignore file deletion errors; runtime setting reset is authoritative.
        }
      }
    }

    const runtime = updateRuntimeDownloaderConfig({
      cookies_file: '',
      cookies_from_browser: '',
    })

    syncRuntimeState(fastify, jobs, runtime)

    return reply.send({
      ok: true,
      data: getCookieFileInfo(runtime.appDir, runtime.runtimeConfig),
    })
  })
}
