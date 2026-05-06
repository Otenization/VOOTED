import { peekYoutubeJobService } from '../../services/youtube-job.service.js'

function requireReady(reply) {
  const jobs = peekYoutubeJobService()
  if (!jobs) {
    reply
      .code(503)
      .send({
        ok: false,
        setup_required: true,
        message: 'First-run setup required. Please complete setup in the browser.',
      })
    return null
  }
  return jobs
}

export default async function vodRoutes(fastify) {
  fastify.get('/meta', async (_request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    const data = jobs.getMeta()
    data.portConflict = fastify.portConflict || false
    data.boundPort = fastify.boundPort || 8111
    return reply.send({ ok: true, data })
  })

  fastify.get('/jobs', async (_request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    return reply.send({ ok: true, data: jobs.listJobs() })
  })

  fastify.get('/jobs/:id', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    const job = jobs.getJob(request.params?.id)
    if (!job) {
      return reply.code(404).send({ ok: false, message: 'Job not found' })
    }
    return reply.send({ ok: true, data: job })
  })

  fastify.post('/preview', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    try {
      const data = jobs.previewUrl(request.body?.url)
      return reply.send({ ok: true, data })
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to preview video',
      })
    }
  })

  fastify.post('/channel/streams/preview', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    try {
      const data = jobs.previewChannelStreams(request.body?.channelUrl)
      return reply.send({ ok: true, data })
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to fetch channel streams',
      })
    }
  })

  fastify.post('/channel/streams/queue', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    try {
      const items = Array.isArray(request.body?.items)
        ? request.body.items
        : (Array.isArray(request.body?.urls) ? request.body.urls : [])
      const data = jobs.queueJobs(items, request.body?.downloadPreset)
      return reply.code(201).send({ ok: true, data })
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to queue channel streams',
      })
    }
  })

  fastify.post('/jobs', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    try {
      const job = jobs.createJob(request.body?.url, request.body?.downloadPreset, request.body?.displayTitle)
      return reply.code(201).send({ ok: true, data: job })
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        message: err instanceof Error ? err.message : 'Invalid request',
      })
    }
  })

  fastify.post('/queue/pause', async (_request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    const data = jobs.pauseQueue()
    return reply.send({ ok: true, data })
  })

  fastify.post('/queue/start', async (_request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    const data = jobs.startQueue()
    return reply.send({ ok: true, data })
  })

  fastify.post('/jobs/:id/cancel', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    const job = jobs.cancelJob(request.params?.id)
    if (!job) {
      return reply.code(404).send({ ok: false, message: 'Job not found' })
    }
    return reply.send({ ok: true, data: job })
  })

  fastify.post('/jobs/:id/resume', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    try {
      const job = jobs.resumeJob(request.params?.id)
      if (!job) {
        return reply.code(404).send({ ok: false, message: 'Job not found' })
      }
      return reply.send({ ok: true, data: job })
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to resume job',
      })
    }
  })

  fastify.post('/jobs/:id/requeue', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    try {
      const job = jobs.requeueJob(request.params?.id)
      if (!job) {
        return reply.code(404).send({ ok: false, message: 'Job not found' })
      }
      return reply.send({ ok: true, data: job })
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to requeue job',
      })
    }
  })

  fastify.delete('/jobs/:id', async (request, reply) => {
    const jobs = requireReady(reply)
    if (!jobs) return
    try {
      const job = jobs.deleteJob(request.params?.id)
      if (!job) {
        return reply.code(404).send({ ok: false, message: 'Job not found' })
      }
      return reply.send({ ok: true, data: job })
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to delete job',
      })
    }
  })
}
