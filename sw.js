importScripts("/prox/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
const PROXY_PREFIX = "/shuttle/";

/**
 * Pre-initialize Scramjet
 * This runs once when the SW starts, preventing race conditions on heavy sites.
 */
const configPromise = scramjet.loadConfig().then(() => {
    scramjet.config.prefix = PROXY_PREFIX;
    if (scramjet.config.files) {
        scramjet.config.files.wasm = "/prox/scram/scramjet.wasm.wasm";
        scramjet.config.files.all = "/prox/scram/scramjet.all.js";
        scramjet.config.files.sync = "/prox/scram/scramjet.sync.js";
    }
    scramjet.config.memory = 1024;
}).catch(console.error);

self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

/**
 * Main Fetch Handler
 */
async function handleRequest(event) {
    const requestUrl = new URL(event.request.url);

    if (scramjet.route(event)) {
        try {
            // Attempt standard Scramjet fetch
            return await scramjet.fetch(event);
        } catch (err) {
            console.warn("Rewriter failed, attempting passthrough for:", event.request.url);
            
            // If it's a TikTok CDN file, bypass the rewriter and just fetch it
            if (event.request.url.includes('tiktokcdn')) {
                const res = await fetch(event.request);
                return res;
            }
            
            return new Response("Proxy rewriting error", { status: 500 });
        }
    }
    return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event));
});
