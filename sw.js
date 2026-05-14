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
    // Wait for initialization to complete
    await engineInitPromise;
    
    // Always check cache for latest engine preference in case it was updated
    const cachedEngine = await getEnginePreference();
    if (cachedEngine && cachedEngine !== currentEngine) {
        currentEngine = cachedEngine;
        console.log(`[SW] Updated engine from cache to: ${currentEngine}`);
    }
    
    const engine = currentEngine;
    const url = event.request.url;
    
    console.log(`[SW] Request to ${url} with engine ${engine}`);
    
    try {
        if (engine === "scramjet") {
            const sj = initScramjet();
            await sj.loadConfig();
            
            if (sj.route(event)) {
                console.log(`[SW:Scramjet] Routing ${url}`);
                return sj.fetch(event);
            }
        } else if (engine === "uv") {
            const uv = initUV();
            
            // Check if request URL includes the UV prefix
            const hasUVPrefix = url.includes(__uv$config.prefix);
            console.log(`[SW:UV] URL has prefix: ${hasUVPrefix}, checking route...`);
            
            // If request is to the UV prefix, MUST route through UV (don't fall back)
            if (hasUVPrefix) {
                console.log(`[SW:UV] FORCING route for ${url}`);
                try {
                    const response = await uv.fetch({ request: event.request });
                    console.log(`[SW:UV] Fetch success`);
                    return response;
                } catch (e) {
                    console.error(`[SW:UV] Fetch error:`, e);
                    return new Response("UV proxy error: " + e.message, { status: 502 });
                }
            }
            
            // For non-prefixed requests, check if UV should handle it
            try {
                const shouldRoute = uv.route({ request: event.request });
                console.log(`[SW:UV] Should route (non-prefixed): ${shouldRoute}`);
                if (shouldRoute) {
                    console.log(`[SW:UV] Routing non-prefixed ${url}`);
                    return uv.fetch({ request: event.request });
                }
            } catch (e) {
                console.error(`[SW:UV] Route check error:`, e);
            }
        }
    } catch (e) {
        console.error(`[SW] Error handling ${engine} request:`, e);
    }
    
    // Fallback to regular fetch (only for non-proxied requests)
    console.log(`[SW] Fallback fetch for ${url}`);
    return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event));
});