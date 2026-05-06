import fp from 'fastify-plugin'
import { logRequest } from '../../lib/utility.js'

export default fp(async function (fastify, opts) {
  fastify.addHook('onRequest', async (request, reply) => {
    const requestData = {
      request_at: new Date(),
      request_ip: request.ip || request.socket.remoteAddress || 'unknown',
      request_to: request.hostname + request.url,
      request_protocol: request.protocol,
      request_method: request.method,
      request_header: request.headers || {},
      request_cookies: request.cookies || [],
      request_body: request.body || {}
    }

    // Log asynchronously without blocking the request
    logRequest(requestData).catch((err) => {
      console.error('Error logging request:', err)
    })
  })
})
