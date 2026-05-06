import { applySelfUpdate, getSelfUpdateStatus } from '../../services/self-update.service.js'

export default async function updateRoutes(fastify) {
  fastify.get('/status', async (_request, reply) => {
    try {
      const data = await getSelfUpdateStatus()
      return reply.send({ ok: true, data })
    } catch (err) {
      return reply.code(500).send({ ok: false, message: err instanceof Error ? err.message : 'Update check failed' })
    }
  })

  // Download latest compatible release, spawn updater handoff, then exit this
  // process. The updater replaces the old executable and launches the new one.
  fastify.post('/apply', async (_request, reply) => {
    try {
      const data = await applySelfUpdate()
      reply.send({ ok: true, data })
      setTimeout(() => process.exit(0), 500)
      return
    } catch (err) {
      return reply.code(400).send({ ok: false, message: err instanceof Error ? err.message : 'Update apply failed' })
    }
  })
}
