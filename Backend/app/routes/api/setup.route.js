import { completeSetup } from '../../services/runtime-bootstrap.service.js'
import { isYtDlpAvailable } from '../../services/yt-dlp-manager.service.js'
import { pickFolder } from '../../services/folder-picker.service.js'
import {
  resetYoutubeJobService,
  peekYoutubeJobService,
} from '../../services/youtube-job.service.js'
import {
  loadConfig,
  resetConfigCache,
  logInit,
  requestLogInit,
  queryLogInit,
} from '../../../lib/utility.js'

export default async function setupRoutes(fastify) {
  // Returns whether first-run GUI setup is still needed, the current app folder, and yt-dlp availability.
  fastify.get('/status', async (_request, reply) => {
    const needsSetup = peekYoutubeJobService() === null
    const ytDlpAvailable = isYtDlpAvailable()
    return reply.send({
      ok: true,
      data: {
        needsSetup,
        appDir: fastify.runtime?.appDir || null,
        ytDlpAvailable,
      },
    })
  })

  // Called by the browser GUI once the user confirms the folder and optional save path.
  fastify.post('/complete', async (request, reply) => {
    if (peekYoutubeJobService() !== null) {
      // Already set up — idempotent OK.
      return reply.send({ ok: true, data: { needsSetup: false } })
    }

    try {
      const vodOutputDir =
        typeof request.body?.vodOutputDir === 'string' ? request.body.vodOutputDir.trim() : ''
      const ytDlpChoice =
        typeof request.body?.ytDlpChoice === 'string' ? request.body.ytDlpChoice : 'auto'

      const runtime = await completeSetup(vodOutputDir, ytDlpChoice)

      // Inject the live runtime + job service into the Fastify instance so all
      // subsequent VOD route handlers work without a process restart.
      fastify.runtime = runtime
      fastify.youtubeJobs = resetYoutubeJobService(runtime)

      // The user just confirmed setup, so it's now safe to materialise the
      // file-touching pieces we deferred at startup: swap the in-memory
      // minimal config for the freshly-written runtime config, then start file
      // logging. Existing fastify.config keeps its identity so other plugins
      // see the merged values.
      try {
        resetConfigCache()
        const fullConfig = loadConfig()
        if (fastify.config && typeof fastify.config === 'object') {
          Object.assign(fastify.config, fullConfig)
        }
        logInit()
        requestLogInit()
        queryLogInit()
      } catch (initErr) {
        // Don't fail setup just because logging couldn't start — the user is
        // already past the point of no return. Surface it to the console.
        console.warn('[VOOTED] Post-setup re-initialisation failed:', initErr?.message || initErr)
      }

      return reply.send({ ok: true, data: { needsSetup: false } })
    } catch (err) {
      return reply
        .code(500)
        .send({ ok: false, message: err instanceof Error ? err.message : 'Setup failed' })
    }
  })

  // Open the OS-native folder picker dialog and return the selected path.
  // Used by the setup screen's Browse button so users don't have to type a
  // path. `path` is null in the response when the user cancels the dialog.
  fastify.post('/pick-folder', async (request, reply) => {
    try {
      const title =
        typeof request.body?.title === 'string' && request.body.title.trim()
          ? request.body.title.trim()
          : 'Select folder'
      const initialDir =
        typeof request.body?.initialDir === 'string' ? request.body.initialDir.trim() : ''
      const path = await pickFolder({ title, initialDir })
      return reply.send({ ok: true, data: { path } })
    } catch (err) {
      return reply
        .code(500)
        .send({ ok: false, message: err instanceof Error ? err.message : 'Folder picker failed' })
    }
  })
}
