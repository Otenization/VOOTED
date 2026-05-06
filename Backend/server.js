import fs from 'fs'
import http from 'http'
import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { ensureRuntimeBootstrap } from './app/services/runtime-bootstrap.service.js'
import {
  loadConfig,
  logInit,
  requestLogInit,
  queryLogInit,
  log,
  buildMinimalRuntimeConfig,
  setCachedConfig,
} from './lib/utility.js'
import dbPlugin from './app/plugins/db.js'
import requestLoggerPlugin from './app/plugins/request-logger.js'
import cronPlugin from './app/plugins/cron.js'
import websocketPlugin from './app/plugins/websocket.js'
import runtimeBootstrapPlugin from './app/plugins/runtime-bootstrap.js'
import routes from './app/routes/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Check if the process already running on a port is VOOTED (by hitting /api/health).
// If it is, reuse that instance — open the browser and exit cleanly.
function checkIfVootedRunning(checkPort) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: 'localhost', port: checkPort, path: '/api/health', method: 'GET', timeout: 1500 },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try {
            const json = JSON.parse(body)
            resolve(json?.service === 'VOOTED API')
          } catch {
            resolve(false)
          }
        })
      }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

async function main() {
  // Pre-load runtime bootstrap. When `vooted.runtime.json` is missing the
  // service returns { needsSetup: true } WITHOUT touching the filesystem, so
  // first-run users see no files appear in their folder yet.
  const bootstrapResult = await ensureRuntimeBootstrap()
  const isFirstRun = bootstrapResult?.needsSetup === true

  // First-run = no files allowed yet. Use an in-memory minimal config and skip
  // every file-creating init step. Once the user clicks Confirm in the GUI
  // setup card, the setup route swaps in the on-disk config and starts logs.
  let config
  if (isFirstRun) {
    config = buildMinimalRuntimeConfig()
    setCachedConfig(config)
  } else {
    config = loadConfig()
    if (bootstrapResult?.runtimeConfig?.app) {
      const rApp = bootstrapResult.runtimeConfig.app
      if (typeof rApp.port === 'number') config.app.port = rApp.port
      if (typeof rApp.auto_open_browser === 'boolean') config.app.auto_open_browser = rApp.auto_open_browser
    }

    const logPath = logInit()
    if (logPath) {
      console.log(`Message log file created at: ${logPath}`)
    }

    const requestLogPath = requestLogInit()
    if (requestLogPath) {
      console.log(`Request log file created at: ${requestLogPath}`)
    }

    const queryLogPath = queryLogInit()
    if (queryLogPath) {
      console.log(`Query log file created at: ${queryLogPath}`)
    }
  }

  const fastify = Fastify({ logger: config.logging?.fastify || false })
  fastify.decorate('config', config)

  const env = process.env.NODE_ENV || 'development'
  const port = process.env.PORT || config.app.port

  function shouldAutoOpenBrowser() {
    if (process.env.VOOTED_NO_BROWSER === '1' || process.env.VOOTE_NO_BROWSER === '1') {
      return false
    }

    if (process.env.CI === 'true') {
      return false
    }

    if (config.app?.auto_open_browser === false) {
      return false
    }

    return true
  }

  function openBrowser(url) {
    if (!shouldAutoOpenBrowser()) {
      return
    }

    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
      return
    }

    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
      return
    }

    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  }

  await log(`Initializing server in ${env} environment${isFirstRun ? ' (first-run mode)' : ''}`, import.meta.url)

  await fastify.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']
  })
  await log(`CORS plugin registered`, import.meta.url)

  await fastify.register(requestLoggerPlugin)
  await log(`Request logger plugin registered`, import.meta.url)

  await fastify.register(runtimeBootstrapPlugin)
  await log(`Runtime bootstrap plugin registered`, import.meta.url)

  // Backward compatible: if `database.enabled` is not set, DB is considered enabled.
  const shouldUseDatabase = config.database?.enabled !== false
  if (shouldUseDatabase) {
    await fastify.register(dbPlugin)
    await log(`Database plugin registered`, import.meta.url)
  } else {
    await log(`Database plugin skipped (database.enabled=false)`, import.meta.url)
  }

  await fastify.register(cronPlugin)
  await log(`Cron plugin registered`, import.meta.url)

  await fastify.register(websocketPlugin)
  await log(`Websocket plugin registered`, import.meta.url)

  // Frontend assets: served from a single source — the pkg snapshot in EXE
  // mode, or Backend/public/dist in dev mode. We deliberately avoid both
  // @fastify/static (it doesn't stream from pkg snapshots) AND extracting the
  // bundle to the user's folder (the user shouldn't see files appear before
  // confirming setup). The custom static handler in routes/index.js reads
  // files via fs.readFileSync, which works on real fs and pkg snapshots alike.
  const staticRoot = process.pkg
    ? join(__dirname, '..', 'public', 'dist')
    : join(__dirname, 'public', 'dist')
  fastify.decorate('staticRoot', staticRoot)
  await log(`Static asset root: ${staticRoot}`, import.meta.url)

  await fastify.register(routes)
  await log(`Routes registered (api + spa fallback)`, import.meta.url)

  // Port binding with auto-retry on conflict.
  let boundPort = port
  let portConflict = false
  const maxRetries = 10

  // Expose port conflict info for the frontend (before listen, so decorators are available before start).
  fastify.decorate('portConflict', portConflict)
  fastify.decorate('boundPort', boundPort)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fastify.listen({
        port: boundPort,
        host: '0.0.0.0'
      })
      if (attempt > 0) {
        portConflict = true
        fastify.portConflict = true
        fastify.boundPort = boundPort
        await log(`Port conflict detected. Using port ${boundPort} instead of ${port}`, import.meta.url)
      }
      break
    } catch (err) {
      if (err.code === 'EADDRINUSE' && attempt < maxRetries) {
        const isVooted = await checkIfVootedRunning(boundPort)
        if (isVooted) {
          await log(`Port ${boundPort} is already running a VOOTED instance — reusing it.`, import.meta.url)
          console.log(`VOOTED is already running on port ${boundPort}. Opening browser…`)
          openBrowser(`http://localhost:${boundPort}`)
          process.exit(0)
        }
        boundPort++
        continue
      }
      throw err
    }
  }

  await log(`Server started successfully on port ${boundPort}`, import.meta.url)
  console.log(`Running in ${env} on port ${boundPort}${isFirstRun ? ' (waiting for first-run setup confirmation)' : ''}`)
  openBrowser(`http://localhost:${boundPort}`)
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
