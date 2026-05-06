import fp from "fastify-plugin"
import websocket from "@fastify/websocket"

export default fp(async function websocketPlugin(fastify) {

    await fastify.register(websocket)

    const connections = new Map()

    function addConnection(userId, socket) {
        if (!connections.has(userId))
            connections.set(userId, new Set())

        connections.get(userId).add(socket)
    }

    function removeConnection(userId, socket) {
        const set = connections.get(userId)

        if (!set) return

        set.delete(socket)

        if (set.size === 0)
            connections.delete(userId)
    }

    function sendToUser(userId, payload) {

        const sockets = connections.get(userId)

        if (!sockets) return

        const msg = JSON.stringify(payload)

        for (const s of sockets) {
            if (s.readyState === 1)
                s.send(msg)
        }

    }

    fastify.decorate("ws", {
        connections,
        sendToUser
    })

})