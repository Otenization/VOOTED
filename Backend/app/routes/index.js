import fs from "fs";
import path from "path";
import apiRoutes from "./api/index.js";

const MIME_BY_EXT = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".txt": "text/plain; charset=utf-8",
};

function readSnapshotSafe(filePath) {
    try {
        return fs.readFileSync(filePath);
    } catch (err) {
        if (err.code === "ENOENT" || err.code === "EISDIR") return null;
        throw err;
    }
}

// Custom static reader that works with pkg snapshot paths AND the real
// filesystem. Used as the SPA / asset fallback so we never have to extract
// public/dist next to the EXE (keeps the user's folder clean before setup).
function serveAssetOrIndex(reply, staticRoot, urlPath) {
    if (!staticRoot) {
        return reply.code(404).send("Frontend not available");
    }

    const cleanUrl = (urlPath || "/").split("?")[0].split("#")[0];
    const requested = cleanUrl === "/" ? "/index.html" : cleanUrl;
    const candidate = path.normalize(path.join(staticRoot, requested));

    let payload = null;
    let resolvedPath = candidate;

    // Path traversal guard: keep the resolved candidate inside staticRoot.
    const inside =
        candidate === staticRoot ||
        candidate.startsWith(staticRoot + path.sep) ||
        candidate.startsWith(staticRoot + "/");

    if (inside) {
        payload = readSnapshotSafe(candidate);
    }

    // SPA fallback — any unknown path serves index.html.
    if (payload === null) {
        resolvedPath = path.join(staticRoot, "index.html");
        payload = readSnapshotSafe(resolvedPath);
    }

    if (payload === null) {
        return reply.code(404).send("Frontend not available");
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_BY_EXT[ext] || "application/octet-stream";
    return reply.header("Content-Type", contentType).send(payload);
}

export default async function routes(fastify) {
    await fastify.register(apiRoutes, { prefix: "/api" });

    fastify.setNotFoundHandler(async (request, reply) => {
        const url = request.raw.url || "";
        if (url.startsWith("/api/")) {
            return reply.code(404).send({ ok: false, message: "API route not found" });
        }
        return serveAssetOrIndex(reply, fastify.staticRoot, url);
    });
}
