"use strict";

const form = document.getElementById("sj-form");
const addressInput = document.getElementById("sj-address");
const searchEngineSelector = document.getElementById("search-engine-selector");
const engineSelector = document.getElementById("engine-selector");
const tabsStrip = document.getElementById("tabs-strip");
const addTabBtn = document.getElementById("add-tab-btn");
const webviewContainer = document.getElementById("webview-container");
const homeTemplate = document.getElementById("home-template");
const bookmarkBtn = document.getElementById("nav-bookmark");
const inspectBtn = document.getElementById("nav-inspect");
const bookmarkBar = document.getElementById("bookmark-bar");

const addBookmarkBtn = document.getElementById("nav-add-bookmark");
const bookmarkModal = document.getElementById("bookmark-modal");
const bmSaveBtn = document.getElementById("bm-save");
const bmCancelBtn = document.getElementById("bm-cancel");
const bmNameInput = document.getElementById("bm-name");
const bmUrlInput = document.getElementById("bm-url");
const fullscreenToggle = document.getElementById("fullscreen-toggle");

let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let bookmarks = JSON.parse(localStorage.getItem("nebula_bookmarks") || "[]");
let proxyEngine = localStorage.getItem("proxy_engine") || "scramjet";
let currentSearchEngine = localStorage.getItem("search_engine") || "duckduckgo";

// --- SEARCH ENGINE TEMPLATES ---
const searchEngines = {
    duckduckgo: "https://www.duckduckgo.com/search?q=%s",
    google: "https://www.google.com/search?q=%s",
    bing: "https://www.bing.com/search?q=%s",
    yahoo: "https://search.yahoo.com/search?p=%s"
};

// --- PROXY ENGINE INITIALIZATION ---
let scramjet = null;
const connection = new BareMux.BareMuxConnection("/prox/baremux/worker.js");

// Initialize based on selected engine
function initializeProxyEngine() {
    if (proxyEngine === "scramjet") {
        const { ScramjetController } = $scramjetLoadController();
        scramjet = new ScramjetController({
            files: {
                wasm: "/prox/scram/scramjet.wasm.wasm",
                all: "/prox/scram/scramjet.all.js",
                sync: "/prox/scram/scramjet.sync.js"
            }
        });
        scramjet.init();
        scramjet.route = "/scramjet/";
    }
}

initializeProxyEngine();

// --- FULLSCREEN HANDLING ---
function getActiveFrameElement() {
    const current = tabs.find(t => t.id === activeTabId);
    if (!current || !current.iframe) {
        console.warn('[Fullscreen] No active tab with iframe');
        return null;
    }
    // prefer wrapper so loading overlay is included
    const el = current.iframe.wrapper || current.iframe.frame;
    console.log('[Fullscreen] Active element:', el?.tagName, 'has requestFullscreen:', !!el?.requestFullscreen);
    return el || null;
}

function enterFullscreen() {
    const el = getActiveFrameElement();
    if (!el) {
        console.error('[Fullscreen] No element to fullscreen');
        return;
    }
    try {
        const promise = el.requestFullscreen ? el.requestFullscreen() : 
                       el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : 
                       Promise.reject('No fullscreen API');
        promise.then(() => console.log('[Fullscreen] Entered fullscreen')).catch(err => console.error('[Fullscreen] Enter failed:', err));
    } catch (e) { console.error('[Fullscreen] Exception during enter:', e); }
}

function exitFullscreen() {
    try {
        const promise = document.exitFullscreen ? document.exitFullscreen() : 
                       document.webkitExitFullscreen ? document.webkitExitFullscreen() : 
                       Promise.reject('No fullscreen API');
        promise.then(() => console.log('[Fullscreen] Exited fullscreen')).catch(err => console.error('[Fullscreen] Exit failed:', err));
    } catch (e) { console.error('[Fullscreen] Exception during exit:', e); }
}

function toggleFullscreen() {
    console.log('[Fullscreen] Toggle called, current fullscreen element:', document.fullscreenElement?.tagName || 'none');
    if (document.fullscreenElement || document.webkitFullscreenElement) exitFullscreen();
    else enterFullscreen();
}

if (fullscreenToggle) {
    fullscreenToggle.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('[Fullscreen] Button clicked');
        toggleFullscreen();
    });
} else {
    console.warn('[Fullscreen] Button not found in DOM');
}

document.addEventListener('fullscreenchange', () => {
    // update icon/state
    if (!fullscreenToggle) return;
    const icon = fullscreenToggle.querySelector('i');
    if (icon) {
        icon.setAttribute('data-lucide', document.fullscreenElement ? 'minimize-2' : 'maximize-2');
        try { lucide.createIcons({ elements: icon, attrs: { width: 16, height: 16, 'stroke-width': 2 } }); } catch (e) {}
    }
});

// --- PREWARM ---
(async () => {
    try {
        if ("serviceWorker" in navigator) {
            const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
            console.log("✅ Service Worker registered successfully");
            
            // Save engine preference to cache for SW to read
            try {
                const cache = await caches.open("nebula-config");
                const response = new Response(JSON.stringify({ engine: proxyEngine }), {
                    headers: { "Content-Type": "application/json" }
                });
                await cache.put("engine-preference", response);
                console.log(`✅ Engine preference '${proxyEngine}' saved to cache`);
            } catch (e) {
                console.error("Failed to save engine preference to cache:", e);
            }
            
            // Wait for service worker to be active
            const controller = await new Promise((resolve) => {
                if (navigator.serviceWorker.controller) {
                    resolve(navigator.serviceWorker.controller);
                } else {
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        resolve(navigator.serviceWorker.controller);
                    }, { once: true });
                }
            });
            
            console.log("✅ Service Worker is now controlling the page");
            
            // Immediately send engine preference to ensure SW knows about it
            if (controller) {
                controller.postMessage({
                    type: "setEngine",
                    engine: proxyEngine
                });
                console.log(`✅ Sent engine preference '${proxyEngine}' to SW immediately`);
            }
        }

        const wispUrl = "wss://wisp.rhw.one/";
        await connection.setTransport("/prox/libcurl/index.mjs", [{ wisp: wispUrl }]);

        console.log(`🚀 Proxy Engine Ready (${proxyEngine.toUpperCase()})`);
    } catch (e) {
        console.error("Proxy init failed:", e);
    }
})();

// --- ENGINE SWITCHER ---
if (engineSelector) {
    engineSelector.value = proxyEngine;
    engineSelector.addEventListener("change", async (e) => {
        const newEngine = e.target.value;
        localStorage.setItem("proxy_engine", newEngine);
        proxyEngine = newEngine;
        console.log(`🔄 Switching to ${newEngine}...`);

        
        // Update cache with new engine preference BEFORE unregistering
        try {
            const cache = await caches.open("nebula-config");
            const response = new Response(JSON.stringify({ engine: newEngine }), {
                headers: { "Content-Type": "application/json" }
            });
            await cache.put("engine-preference", response);
            console.log(`✅ Cache updated with engine: ${newEngine}`);
        } catch (err) {
            console.error("Failed to update cache:", err);
        }
        
        // Unregister old service worker
        if (navigator.serviceWorker) {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (let registration of registrations) {
                    await registration.unregister();
                }
                console.log("✅ Unregistered old service workers");
            } catch (err) {
                console.error("Failed to unregister:", err);
            }
        }
        
        // Wait a moment for unregistration to complete
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Re-register service worker and wait for it to be active
        if (navigator.serviceWorker) {
            try {
                const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
                console.log("✅ Service Worker registered");
                let newController = null;
                window.location.reload(); // Force reload to ensure new SW takes control
                
                // If there's already an active SW, wait for it to change
                if (navigator.serviceWorker.controller) {
                    newController = await new Promise((resolve) => {
                        navigator.serviceWorker.addEventListener('controllerchange', () => {
                            resolve(navigator.serviceWorker.controller);
                        }, { once: true });
                    });
                } else {
                    // If no active SW yet, wait for the registered one to activate
                    newController = await new Promise((resolve) => {
                        registration.addEventListener('updatefound', () => {
                            const installingWorker = registration.installing;
                            installingWorker.addEventListener('statechange', () => {
                                if (installingWorker.state === 'activated') {
                                    resolve(navigator.serviceWorker.controller);
                                }
                            });
                        });
                        // Also set up a timeout in case update is immediate
                        setTimeout(() => resolve(navigator.serviceWorker.controller), 1000);
                    });
                }
                
                console.log("✅ New service worker is active and controlling the page");
                
                // Notify controller of engine change
                if (newController) {
                    newController.postMessage({
                        type: "setEngine",
                        engine: newEngine
                    });
                    console.log("✅ Engine preference sent to service worker");

                }
            } catch (err) {
                console.error("❌ Failed to register service worker:", err);
            }
        }
        
        // Close all tabs and reinitialize
        const tabIds = [...tabs].map(t => t.id);
        console.log(`Closing ${tabIds.length} tabs...`);
        tabIds.forEach(id => closeTab(id));
        initializeProxyEngine();
        
        // Wait a moment to ensure SW is fully ready before creating new tab
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Ensure at least one tab exists
        if (tabs.length === 0) {
            console.log("Creating new tab after engine switch...");
            createTab();
        }
        
        console.log(`✅ Switched to ${newEngine}`);
    });
}

// --- SEARCH ENGINE SWITCHER ---
if (searchEngineSelector) {
    searchEngineSelector.value = currentSearchEngine;
    searchEngineSelector.addEventListener("change", (e) => {
        const newEngine = e.target.value;
        localStorage.setItem("search_engine", newEngine);
        currentSearchEngine = newEngine;
        console.log(`🔍 Switched search engine to ${newEngine}`);
    });
}

// --- NAVIGATION ---
async function navigateToUrl(inputUrl) {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab) return;

    const normalizeUrl = (url) => {
        if (!url.startsWith("http")) return "https://" + url;
        return url;
    };

    const url = search(inputUrl) || normalizeUrl(inputUrl);

    // Ensure service worker is ready before navigating
    if (navigator.serviceWorker) {
        try {
            await navigator.serviceWorker.ready;
        } catch (e) {
            console.error("Service worker not ready:", e);
        }
    }

    // create frame if needed
    if (!currentTab.iframe) {
        let frame;
        if (proxyEngine === "scramjet") {
            frame = scramjet.createFrame();
            frame.frame.classList.add("sj-frame");
        } else {
            // UV mode: create iframe
            frame = document.createElement("iframe");
            frame.classList.add("uv-frame");
            frame.setAttribute("allowfullscreen", "true");
        }

        const frameEl = proxyEngine === "scramjet" ? frame.frame : frame;
        Object.assign(frameEl.style, {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: "none",
            margin: "0",
            padding: "0",
            display: "block"
        });

        // wrapper holds the frame and the loading bar overlay
        const wrapper = document.createElement('div');
        wrapper.className = 'frame-wrapper';
        Object.assign(wrapper.style, { position: 'relative', width: '100%', height: '100%' });

        const loading = createLoadingBarElement();
        wrapper.appendChild(loading.container);
        wrapper.appendChild(frameEl);

        currentTab.contentEl.style.display = "none";
        webviewContainer.appendChild(wrapper);
        currentTab.iframe = { frame: frameEl, raw: frame, scramjet: proxyEngine === "scramjet" };
        currentTab.iframe.wrapper = wrapper;
        currentTab.iframe.loading = loading;

        if (proxyEngine === "scramjet") {
            setupFrameInjection(frame);
        }

        // finish loading when iframe fires load
        try {
            frameEl.addEventListener('load', () => {
                try { currentTab.iframe.loading.finish(); } catch (e) { /* ignore */ }
                
                // Extract and display page title from iframe
                try {
                    const pageTitle = frameEl.contentWindow.document.title || "Untitled";
                    currentTab.el.querySelector(".tab-title").textContent = pageTitle;
                    console.log('[Tab Title] Updated to:', pageTitle);
                } catch (e) {
                    console.warn('[Tab Title] Could not extract title:', e);
                }
            });
        } catch (e) { }
    }

    // show wrapper/frame
    if (currentTab.iframe.wrapper) currentTab.iframe.wrapper.style.display = 'block';
    else currentTab.iframe.frame.style.display = "block";

    currentTab.currentUrl = inputUrl;

    // start loading UI then navigate
    try { currentTab.iframe.loading.start(); } catch (e) { }

    // Navigate based on engine
    if (proxyEngine === "scramjet" && currentTab.iframe.raw) {
        console.log("Navigating Scramjet to:", url);
        currentTab.iframe.raw.go(url);
    } else if (proxyEngine === "uv") {
        // UV uses direct src assignment with encoded URL
        try {
            // Make sure UV config is available
            if (typeof __uv$config === 'undefined') {
                console.error("UV config not loaded");
                console.log("Available globals:", Object.keys(window).filter(k => k.includes('uv')));
                currentTab.iframe.frame.src = url;
            } else {
                const encodedUrl = __uv$config.prefix + __uv$config.encodeUrl(url);
                console.log("Original URL:", url);
                console.log("UV Config Prefix:", __uv$config.prefix);
                console.log("Encoded URL:", encodedUrl);
                console.log("Full URL:", new URL(encodedUrl, location.origin).href);
                currentTab.iframe.frame.src = encodedUrl;
            }
        } catch (e) {
            console.error("UV navigation failed:", e);
            console.error(e.stack);
            // Fallback to regular navigation
            currentTab.iframe.frame.src = url;
        }
    }

    addressInput.value = inputUrl;
    currentTab.el.querySelector(".tab-title").textContent = "Loading...";
    // Actual page title will be set when page loads
    
    // Update favicon
    if (currentTab.faviconEl) {
        currentTab.faviconEl.src = getFaviconUrl(url);
    }
    
    updateBookmarkIcon();
}

// --- BOOKMARKS ---
function renderBookmarks() {
    bookmarkBar.innerHTML = "";
    const fragment = document.createDocumentFragment();

    bookmarks.forEach(bm => {
        const div = document.createElement("div");
        div.className = "bookmark-item";

        const isJS = bm.url.startsWith("javascript:");
        const iconUrl = isJS
            ? "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2326ff9a'><path d='M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93M4 15c0 4.42 3.58 8 8 8s8-3.58 8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z'/></svg>"
            : `https://www.google.com/s2/favicons?domain=${bm.url}&sz=32`;

        div.innerHTML = `<img src="${iconUrl}" class="bookmark-icon"><span>${bm.title}</span>`;

        div.onclick = () => {
            if (isJS) return;
            navigateToUrl(bm.url);
        };

        div.oncontextmenu = (e) => {
            e.preventDefault();
            if (confirm("Delete bookmark?")) {
                bookmarks = bookmarks.filter(b => b.url !== bm.url);
                localStorage.setItem("nebula_bookmarks", JSON.stringify(bookmarks));
                renderBookmarks();
            }
        };

        fragment.appendChild(div);
    });

    bookmarkBar.appendChild(fragment);
}

// --- TABS ---
function createTab(url = null) {
    tabCounter++;
    const tabId = tabCounter;

    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.id = tabId;

    const faviconSrc = url ? getFaviconUrl(url) : "https://cdn.jsdelivr.net/gh/asemits/starlight/public/static/logo.png";

    tabEl.innerHTML = `
        <img class="tab-favicon" src="${faviconSrc}" alt="favicon">
        <span class="tab-title">New Tab</span>
        <button class="tab-close">X</button>
    `;

    tabEl.onclick = (e) => {
        if (!e.target.classList.contains("tab-close")) switchTab(tabId);
    };

    tabEl.querySelector(".tab-close").onclick = (e) => {
        e.stopPropagation();
        closeTab(tabId);
    };

    tabsStrip.insertBefore(tabEl, addTabBtn);

    const contentEl = homeTemplate.cloneNode(true);
    contentEl.id = `content-${tabId}`;
    contentEl.style.display = "none";

    webviewContainer.appendChild(contentEl);

    tabs.push({
        id: tabId,
        el: tabEl,
        contentEl,
        iframe: null,
        currentUrl: url,
        faviconEl: tabEl.querySelector(".tab-favicon")
    });

    switchTab(tabId);

    if (url) navigateToUrl(url);
}

function switchTab(id) {
    activeTabId = id;
    const current = tabs.find(t => t.id === id);
    if (!current) return;

    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    current.el.classList.add("active");

    tabs.forEach(t => {
        t.contentEl.style.display = "none";
        if (t.iframe) {
            if (t.iframe.wrapper) t.iframe.wrapper.style.display = 'none';
            else t.iframe.frame.style.display = 'none';
        }
    });

    if (current.iframe) {
        if (current.iframe.wrapper) current.iframe.wrapper.style.display = 'block';
        else current.iframe.frame.style.display = 'block';
    } else {
        current.contentEl.style.display = "flex";
    }

    addressInput.value = current.currentUrl || "";
    updateBookmarkIcon();
}

function closeTab(id) {
    const index = tabs.findIndex(t => t.id === id);
    if (index === -1) return;

    const tab = tabs[index];
    tab.el.remove();
    tab.contentEl.remove();
    if (tab.iframe) {
        if (tab.iframe.wrapper) tab.iframe.wrapper.remove();
        else if (tab.iframe.frame) tab.iframe.frame.remove();
        // try to stop any loading animation
        try { tab.iframe.loading && tab.iframe.loading.finish(); } catch (e) {}
    }

    tabs.splice(index, 1);

    if (tabs.length > 0) switchTab(tabs[Math.max(0, index - 1)].id);
    else createTab();
}

// --- FRAME INJECTION ---
function setupFrameInjection(frame) {
    if (!frame || !frame.frame) return;
    frame.frame.onload = () => {
        try {
            const win = frame.frame.contentWindow;
            const doc = win.document;

            const script = doc.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/eruda";

            script.onload = () => {
                win.eruda.init();
                win.eruda.hide();
            };

            doc.head.appendChild(script);

            doc.addEventListener("click", (e) => {
                const a = e.target.closest("a");
                if (!a) return;
                e.preventDefault();
                win.location.href = a.href;
            });

        } catch (e) {
            console.warn("Injection blocked:", e);
        }
    };
}

// --- LOADING BAR HELPERS ---
function createLoadingBarElement() {
    const container = document.createElement('div');
    Object.assign(container.style, { position: 'absolute', top: '0', left: '0', right: '0', height: '4px', zIndex: 9999, pointerEvents: 'none' });
        const bar = document.createElement('div');
        Object.assign(bar.style, { height: '100%', width: '0%', background: '#6f8078', transition: 'width 200ms ease, opacity 300ms ease', opacity: '1' });
    container.appendChild(bar);

    let interval = null;
    let current = 0;

    function setPercent(p) {
        const pct = Math.max(0, Math.min(100, p));
        bar.style.width = pct + '%';
    }

    function start() {
        // reset
        if (interval) clearInterval(interval);
        bar.style.opacity = '1';
        current = 3;
        setPercent(current);
        const cap = 60 + Math.floor(Math.random() * 20);
        interval = setInterval(() => {
            if (current < cap) {
                current += Math.random() * 6;
                setPercent(current);
            } else {
                current += Math.random() * 1.5;
                setPercent(Math.min(current, cap + 5));
            }
        }, 250);
    }

    function finish() {
        if (interval) { clearInterval(interval); interval = null; }
        setPercent(100);
        setTimeout(() => { bar.style.opacity = '0'; }, 300);
        setTimeout(() => { setPercent(0); bar.style.opacity = '0'; }, 700);
    }

    return { container, start, finish, setPercent };
}

// --- UI ---
function updateBookmarkIcon() {
    const t = tabs.find(x => x.id === activeTabId);
    if (!t?.currentUrl) return;

    const exists = bookmarks.some(b => b.url === t.currentUrl);
    bookmarkBtn.querySelector("i").className =
        exists ? "fa-solid fa-star" : "fa-regular fa-star";
}

// --- EVENTS ---
form.onsubmit = (e) => {
    e.preventDefault();
    navigateToUrl(addressInput.value);
};

addTabBtn.onclick = () => createTab();
bookmarkBtn.onclick = () => {
    const t = tabs.find(x => x.id === activeTabId);
    if (!t?.currentUrl) return;

    const url = t.currentUrl;
    const i = bookmarks.findIndex(b => b.url === url);

    if (i >= 0) bookmarks.splice(i, 1);
    else {
        const title = prompt("Bookmark name:");
        if (title) bookmarks.push({ url, title });
    }

    localStorage.setItem("nebula_bookmarks", JSON.stringify(bookmarks));
    renderBookmarks();
    updateBookmarkIcon();
};

inspectBtn.onclick = () => {
    const t = tabs.find(x => x.id === activeTabId);
    if (t?.iframe) {
        t.iframe.frame.contentWindow.postMessage("toggle-eruda", "*");
    }
};

document.getElementById("nav-reload").onclick = () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab?.iframe?.frame?.contentWindow) {
        tab.iframe.frame.contentWindow.location.reload();
    }
};

document.getElementById("nav-back").onclick = () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab?.iframe?.frame?.contentWindow) {
        tab.iframe.frame.contentWindow.history.back();
    }
};

document.getElementById("nav-forward").onclick = () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab?.iframe?.frame?.contentWindow) {
        tab.iframe.frame.contentWindow.history.forward();
    }
};

// --- START ---
console.log("🚀 Nebula Browser loaded");
console.log("Current proxy engine:", proxyEngine);
console.log("Current search engine:", currentSearchEngine);
console.log("UV available:", typeof __uv$config !== 'undefined');
console.log("Scramjet available:", typeof $scramjetLoadController !== 'undefined');

renderBookmarks();
createTab();

// --- HELPER FUNCTIONS ---
function getFaviconUrl(urlString) {
    try {
        const url = new URL(urlString);
        const domain = url.hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=24`;
    } catch (err) {
        // If URL parsing fails, return new tab logo
        return "https://cdn.jsdelivr.net/gh/asemits/starlight/public/static/logo.png";
    }
}

function search(input) {
	// If it's already a URL, return it
	try {
		if (input.startsWith("http://") || input.startsWith("https://")) {
			return new URL(input).toString();
		}
	} catch (err) {}
	
	// Try to detect if it's a domain (has . and no spaces)
	try {
		if (input.includes(".") && !input.includes(" ")) {
			const url = new URL(`http://${input}`);
			// Validate it looks like a real domain (has proper TLD)
			if (url.hostname.includes(".")) {
				return url.toString();
			}
		}
	} catch (err) {}
	
	// Otherwise, treat as search query
	const template = searchEngines[currentSearchEngine] || searchEngines.duckduckgo;
	return template.replace("%s", encodeURIComponent(input));
}

// Create BareMux port for UV engine support
function createBareMuxPort() {
	const bareMuxConnection = new BareMux.BareMuxConnection("/prox/baremux/worker.js");
	void bareMuxConnection.setTransport("/prox/libcurl/index.mjs", [
		{ websocket: "wss://wisp.rhw.one/" },
	]).catch((err) => {
		console.error("Failed to initialize BareMux transport for UV.", err);
	});
	const port = bareMuxConnection.getInnerPort();
	port.start?.();
	return port;
}

// Listen for port requests from UV
window.addEventListener("message", async (event) => {
    const payload = event.data;
    if (!payload || payload.type !== "getPort" || !(payload.port instanceof MessagePort)) {
        return;
    }
    const getValidPort = () => {
        try {
            const port = createBareMuxPort();
            if (!port) throw new Error("Port creation returned null");
            return port;
        } catch (err) {
            console.warn("BareMux port creation failed, attempting to recreate...", err);
            return createBareMuxPort(); 
        }
    };

    const finalPort = getValidPort();
    if (finalPort) {
        payload.port.postMessage(finalPort, [finalPort]);
    } else {
        console.error("Critical Failure: Could not recreate BareMux port.");
    }
});