import exampleItemRoutes from './template-item.route.js'
import vodRoutes from './vod.route.js'
import setupRoutes from './setup.route.js'
import settingsRoutes from './settings.route.js'
import updateRoutes from './update.route.js'

export default async function (fastify) {
  // You can add api-level permissions/middleware here in the future
  // fastify.addHook('onRequest', async (request, reply) => {
  //   // Check API access permissions, authentication, etc.
  // })


  fastify.get('/health', async () => {
    return {
      ok: true,
      service: 'VOOTED API',
      timestamp: new Date().toISOString()
    }
  })

  fastify.get('/template/meta', async () => {
    const dbEnabled = fastify.config?.database?.enabled !== false

    return {
      ok: true,
      data: {
        name: 'VOOTED',
        frontend: 'React + Vite',
        backend: 'Fastify + yt-dlp worker',
        databaseEnabled: dbEnabled,
        notes: [
          'VOOTED runs as a portable-first backend with local runtime config and file-based job persistence.',
          'Database remains disabled by default for the portable build flow.',
          'Use /api/vod/* routes for YouTube VOD download jobs and queue status.',
        ],
      },
    }
  })

  await fastify.register(setupRoutes, { prefix: '/setup' })

  // Graceful shutdown — flushes the response, then force-exits.
  // Don't await fastify.close(): pending websocket / keep-alive connections can
  // hang it indefinitely and the process never dies. Force exit shortly after
  // the reply is sent so the EXE always terminates when the user clicks Close.
  fastify.post('/shutdown', async (_request, reply) => {
    reply.send({ ok: true, message: 'Shutting down.' })
    setTimeout(() => process.exit(0), 200)
  })

  await fastify.register(vodRoutes, { prefix: '/vod' })

  await fastify.register(settingsRoutes, { prefix: '/settings' })

  await fastify.register(updateRoutes, { prefix: '/update' })

  await fastify.register(exampleItemRoutes, { prefix: '/template-items' })

  // Future: Add other API routes here
  // await fastify.register(otherRoutes, { prefix: '/other' })
}
