import fp from 'fastify-plugin'
import { initDB } from '../../database/index.js'
import { setDB } from '../../lib/utility.js'

export default fp(async function (fastify, opts) {
  const db = await initDB()
  setDB(db)
  fastify.decorate('db', db)
})