function ensureTemplateItemsModel(fastify, reply) {
  if (!fastify.db?.TemplateItems) {
    reply.code(503).send({
      ok: false,
      message: 'TemplateItems model is unavailable. Enable and configure the database in vooted.runtime.json.',
    })
    return null
  }

  return fastify.db.TemplateItems
}

function normalizeText(value) {
  return String(value || '').trim()
}

export default async function templateItemRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    const TemplateItems = ensureTemplateItemsModel(fastify, reply)
    if (!TemplateItems) {
      return
    }

    const query = request.query || {}
    const status = normalizeText(query.status)
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)

    const where = {}
    if (status) {
      where.status = status
    }

    const rows = await TemplateItems.findAll({
      where,
      order: [['updated_at', 'DESC']],
      limit,
    })

    return reply.send({ ok: true, data: rows })
  })

  fastify.post('/', async (request, reply) => {
    const TemplateItems = ensureTemplateItemsModel(fastify, reply)
    if (!TemplateItems) {
      return
    }

    const body = request.body || {}
    const name = normalizeText(body.name)
    const summary = normalizeText(body.summary)
    const status = normalizeText(body.status) || 'draft'
    const priority = normalizeText(body.priority) || 'medium'

    if (!name) {
      return reply.code(400).send({ ok: false, message: 'name is required' })
    }

    const row = await TemplateItems.create({
      name,
      summary,
      status,
      priority,
    })

    return reply.code(201).send({ ok: true, data: row })
  })

  fastify.patch('/:id', async (request, reply) => {
    const TemplateItems = ensureTemplateItemsModel(fastify, reply)
    if (!TemplateItems) {
      return
    }

    const itemId = Number(request.params?.id)
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.code(400).send({ ok: false, message: 'invalid item id' })
    }

    const row = await TemplateItems.findByPk(itemId)
    if (!row) {
      return reply.code(404).send({ ok: false, message: 'item not found' })
    }

    const body = request.body || {}
    const nextData = {}

    if (body.name !== undefined) nextData.name = normalizeText(body.name)
    if (body.summary !== undefined) nextData.summary = normalizeText(body.summary)
    if (body.status !== undefined) nextData.status = normalizeText(body.status) || row.status
    if (body.priority !== undefined) nextData.priority = normalizeText(body.priority) || row.priority

    await row.update(nextData)

    return reply.send({ ok: true, data: row })
  })
}
