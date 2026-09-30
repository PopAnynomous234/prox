// Load both proxy engines
importScripts("/prox/scram/scramjet.all.js");
importScripts("/prox/baremux/index.js");
importScripts("/prox/uv/uv.bundle.js");
importScripts("/prox/uv/uv.config.js");
importScripts("/prox/uv/uv.sw.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();

// Determine which engine to use - check cache first
let currentEngine = "scramjet";
let scramjet = null;
let uvSW = null;

// Try to read engine preference from cache or initialize
async function getEnginePreference() {
    try {
        const cache = await caches.open("nebula-config");
        const response = await cache.match("engine-preference");
        if (response) {
            const data = await response.json();
            return data.engine || "scramjet";
        }
    } catch (e) {
        console.log("Cache read failed:", e);
    }
    return "scramjet";
}

// Save engine preference to cache
async function setEnginePreference(engine) {
    try {
        const cache = await caches.open("nebula-config");
        const response = new Response(JSON.stringify({ engine }), {
            headers: { "Content-Type": "application/json" }
        });
        await cache.put("engine-preference", response);
    } catch (e) {
        console.error("Cache write failed:", e);
    }
}

// Initialize engine on startup and store the promise
let engineInitPromise = (async () => {
    currentEngine = await getEnginePreference();
    console.log(`🚀 Service Worker initialized with engine: ${currentEngine}`);
})();

// Initialize UV cookies storage
self.__uv$cookies = "";

// Initialize Scramjet
function initScramjet() {
    if (!scramjet) {
        scramjet = new ScramjetServiceWorker({
            prefix: "/scramjet/"
        });
        console.log("Scramjet initialized");
    }
    return scramjet;
}

// Initialize UV
function initUV() {
    if (!uvSW) {
        // Make sure cookies are initialized
        if (!self.__uv$cookies) {
            self.__uv$cookies = "";
        }
        
        // Create UV service worker with config
        try {
            uvSW = new UVServiceWorker(__uv$config);
            console.log("UV Service Worker initialized with config:", __uv$config);
        } catch (e) {
            console.error("Failed to initialize UV Service Worker:", e);
            throw e;
        }
    }
    return uvSW;
}

// Listen for engine change notifications from main thread
self.addEventListener("message", async (event) => {
    if (event.data?.type === "setEngine") {
        const newEngine = event.data.engine;
        currentEngine = newEngine;
        
        // Save preference to cache
        await setEnginePreference(newEngine);
        
        // Reset the previously initialized engine so it reinitializes with the new one
        if (newEngine === "scramjet" && uvSW) {
            uvSW = null;
            console.log("💾 Cleared UV SW, ready to use Scramjet");
        } else if (newEngine === "uv" && scramjet) {
            scramjet = null;
            console.log("💾 Cleared Scramjet, ready to use UV");
        }
        
        console.log(`✅ Service Worker switched to ${newEngine}`);
    }
});

async function handleRequest(event) {
    console.log(`[SW:HANDLE] Started handling request`);
    
    await engineInitPromise;

    const engine = currentEngine;
    const url = event.request.url;
    
    console.log(`[SW] Request to ${url} with engine ${engine}`);
    
    const looksProxied =
        url.startsWith(`${self.location.origin}/scramjet/`) ||
        url.includes(__uv$config.prefix);

    try {
        if (engine === "scramjet") {
            const sj = initScramjet();
            await sj.loadConfig();
            
            if (sj.route(event)) {
                console.log(`[SW:Scramjet] Routing ${url}`);
                const response = await sj.fetch(event);
                return stripSecurityHeaders(response); // <-- STRIP HEADERS HERE
            }
        } else if (engine === "uv") {
            const uv = initUV();
            const hasUVPrefix = url.includes(__uv$config.prefix);
            
            if (hasUVPrefix) {
                console.log(`[SW:UV] FORCING route for ${url}`);
                try {
                    const response = await uv.fetch({ request: event.request });
                    return stripSecurityHeaders(response); // <-- STRIP HEADERS HERE
                } catch (e) {
                    console.error(`[SW:UV] Fetch error:`, e);
                    return new Response("UV proxy error: " + e.message, { status: 502 });
                }
            }
            
            try {
                const shouldRoute = uv.route({ request: event.request });
                if (shouldRoute) {
                    console.log(`[SW:UV] Routing non-prefixed ${url}`);
                    const response = await uv.fetch({ request: event.request });
                    return stripSecurityHeaders(response); // <-- STRIP HEADERS HERE
                }
            } catch (e) {
                console.error(`[SW:UV] Route check error:`, e);
            }
        }
    } catch (e) {
        console.error(`[SW] Error handling ${engine} request:`, e);
        if (looksProxied) {
            return new Response("Proxy error: " + (e?.message || e), { status: 502 });
        }
    }
    
   if (new URL(url).origin === self.location.origin && !url.includes("/prox/")) {
    console.warn("[SW] UNROUTED same-origin request (escaped proxy?):", url,
        "referrer:", event.request.referrer, "dest:", event.request.destination);
}
return fetch(event.request);
}

// Helper to strip restrictive security headers from proxied responses
function stripSecurityHeaders(response) {
    if (!response) return response;

    // Opaque / opaqueredirect responses (common for redirects scramjet/UV
    // pass through untouched — auth flows, CDN redirects, video segment
    // redirects) lock status at 0 and hide headers/body entirely. Rebuilding
    // a Response from one throws "status 0 outside range [200,599]", which
    // used to be swallowed by handleRequest's catch and silently fall back
    // to a raw fetch of this same /scramjet/... path — which Firebase's
    // rewrite resolves to index.html, so the "proxied page" became your own
    // homepage with no visible error. Pass these straight through instead.
    if (response.type === "opaque" || response.type === "opaqueredirect") {
        return response;
    }

    try {
        const newHeaders = new Headers(response.headers);

        // Remove headers that cause "refused to connect" or iframe blocks
        newHeaders.delete("Cross-Origin-Embedder-Policy");
        newHeaders.delete("Cross-Origin-Opener-Policy");
        newHeaders.delete("X-Frame-Options");
        newHeaders.delete("Content-Security-Policy");

        // Allow cross-origin framing and sub-resource loading
        newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
        newHeaders.set("Access-Control-Allow-Origin", "*");

        // Responses with these statuses are forbidden from carrying a body
        // at all — the Response constructor throws if you pass one anyway.
        const forbidsBody = [101, 103, 204, 205, 304].includes(response.status);

        return new Response(forbidsBody ? null : response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });
    } catch (e) {
        console.error("[SW] Failed to strip headers, passing response through unmodified:", e);
        return response;
    }
}

self.addEventListener("fetch", (event) => {
    const url = event.request.url;
    console.log(`[SW:FETCH] Intercepted: ${url}`);
    event.respondWith(handleRequest(event));
});