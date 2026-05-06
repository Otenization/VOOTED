import fp from 'fastify-plugin'
import { cronManager } from '../../lib/utility.js'

export default fp(async function (fastify, opts) {

    // cronManager.createJob('example', '*/10 * * * * *', async () => {
    //     fastify.log.info('Cron running...')
    //     // your task here
    // }, { isLog: true })

    // // start when server ready
    // fastify.addHook('onReady', async () => {
    //     cronManager.startAll()
    //     fastify.log.info('Cron jobs started')
    // })

    // // stop when server shutdown
    // fastify.addHook('onClose', async () => {
    //     cronManager.stopAll()
    //     fastify.log.info('Cron jobs stopped')
    // })

    // Decorate fastify with cronManager for easy access
    fastify.decorate('cronManager', cronManager)

})
