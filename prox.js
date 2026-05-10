"use strict";

const form = document.getElementById("sj-form");
const addressInput = document.getElementById("sj-address");
const searchEngine = document.getElementById("sj-search-engine");
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
const proxySelect = document.getElementById("proxy-select");

let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let bookmarks = JSON.parse(localStorage.getItem("delta_bookmarks") || "[]");

// Proxy abstraction to support multiple proxy backends (scramjet, ultraviolet)
class ScramjetProxy {
    constructor() {
        this.name = 'scramjet';
        this.controller = null;
        this.inited = false;
    }

    async init() {
        if (this.inited) return;
        const { ScramjetController } = $scramjetLoadController();
        this.controller = new ScramjetController({
            files: {
                wasm: "/prox/scram/scramjet.wasm.wasm",
                all: "/prox/scram/scramjet.all.js",
                sync: "/prox/scram/scramjet.sync.js"
            }
        });

        await this.controller.init();
        this.controller.route = "/scramjet/";

        // connection used for bare-mux transports
        this.connection = new BareMux.BareMuxConnection("/prox/baremux/worker.js");
        this.inited = true;
    }

    createFrame() {
        const frame = this.controller.createFrame();
        frame.frame.classList.add("sj-frame");
        Object.assign(frame.frame.style, {
            border: "none",
            width: "100%",
            height: "100%",
            margin: "0",
            padding: "0",
            display: "block"
        });
        return frame;
    }

    async registerSW() {
        if ("serviceWorker" in navigator) {
            await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        }
    }

    async prewarmTransport(opts) {
        if (!this.inited) await this.init();
        try {
            const wispUrl = opts?.wisp || "wss://wisp.rhw.one/";
            await this.connection.setTransport("/prox/libcurl/index.mjs", [{ wisp: wispUrl }]);
        } catch (e) {
            console.warn('ScramjetTransport prewarm failed', e);
        }
    }
}

class UVProxy {
    constructor() {
        this.name = 'ultraviolet';
        this.inited = false;
        this.encode = null;
    }

    async loadScript(url) {
        if (document.querySelector(`script[src="${url}"]`)) return;
        return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = () => res();
            s.onerror = (e) => rej(e);
            document.head.appendChild(s);
        });
    }

    async init() {
        if (this.inited) return;
        // load bundle and client and config
        await this.loadScript('/prox/prox/uv/uv.bundle.js');
        await this.loadScript('/prox/prox/uv/uv.client.js');
        await this.loadScript('/prox/prox/uv/uv.config.js');

        // Ultraviolet global should now be available
        this.UV = window.Ultraviolet;
        // fallback encoder
        this.encode = (this.UV && this.UV.codec && this.UV.codec.xor && this.UV.codec.xor.encode)
            ? this.UV.codec.xor.encode
            : (u => encodeURIComponent(u));

        this.prefix = (self.__uv$config && self.__uv$config.prefix) || '/service/uv/';
        this.inited = true;
    }

    createFrame() {
        const iframe = document.createElement('iframe');
        iframe.classList.add('sj-frame');
        Object.assign(iframe.style, {
            border: 'none',
            width: '100%',
            height: '100%',
            margin: '0',
            padding: '0',
            display: 'block'
        });

        return {
            frame: iframe,
            go: (url) => {
                try {
                    const encoded = this.encode(url);
                    iframe.src = `${location.origin}${this.prefix}${encoded}`;
                } catch (e) {
                    iframe.src = url; // fallback
                }
            }
        };
    }

    async registerSW() {
        if ("serviceWorker" in navigator) {
            // register the ultraviolet service worker script bundled in the prox folder
            await navigator.serviceWorker.register('/prox/prox/uv/uv.sw.js', { scope: '/' });
        }
    }
}

const proxyManager = {
    backends: {
        scramjet: new ScramjetProxy(),
        ultraviolet: new UVProxy()
    },
    current: null,
    async setProxy(name) {
        if (!this.backends[name]) name = 'scramjet';
        this.current = this.backends[name];
        localStorage.setItem('delta_proxy', name);
        await this.current.init();
        await this.current.registerSW();
        // prewarm transports for scramjet specifically
        if (name === 'scramjet') await this.backends.scramjet.prewarmTransport({ wisp: 'wss://wisp.rhw.one/' });
        if (typeof updateProxyIndicator === 'function') updateProxyIndicator(name);
    },
    createFrame() {
        return this.current.createFrame();
    }
};

// --- PREWARM / INITIAL PROXY SETUP ---
(async () => {
    try {
        const saved = localStorage.getItem('delta_proxy') || 'scramjet';
        if (proxySelect) {
            proxySelect.value = saved;
            proxySelect.addEventListener('change', async (e) => {
                await proxyManager.setProxy(e.target.value);
            });
        }

        await proxyManager.setProxy(saved);

        console.log("🚀 Proxy Engine Ready (", saved, ")");
    } catch (e) {
        console.error("Proxy init failed:", e);
    }
})();

// --- NAVIGATION ---
async function navigateToUrl(inputUrl) {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab) return;

    const normalizeUrl = (url) => {
        if (!url.startsWith("http")) return "https://" + url;
        return url;
    };

    const rawUrl = normalizeUrl(inputUrl);
    const url = search(rawUrl, searchEngine.value);

    // create frame if needed (use currently selected proxy)
    if (!currentTab.iframe) {
        const frame = proxyManager.createFrame();

        // wrap frame in a relative container so we can overlay a loading bar
        const wrapper = document.createElement('div');
        wrapper.className = 'frame-wrapper';
        Object.assign(wrapper.style, { position: 'relative', width: '100%', height: '100%' });

        // ensure the frame element fills the wrapper
        Object.assign(frame.frame.style, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' });

        wrapper.appendChild(frame.frame);

        currentTab.contentEl.style.display = "none";
        webviewContainer.appendChild(wrapper);
        currentTab.iframe = frame;
        currentTab.iframe.container = wrapper;

        setupFrameInjection(frame);

        // attach loading bar behavior
        attachLoadingBarToTab(currentTab);
    }

    // show frame container
    if (currentTab.iframe.container) currentTab.iframe.container.style.display = 'block';
    else currentTab.iframe.frame.style.display = 'block';
    currentTab.currentUrl = inputUrl;

    // start loading simulation and then navigate
    startLoadingSimulation(currentTab);

    // FIXED SCRAMJET CALL (no manual /scramjet/ prefix)
    currentTab.iframe.go(url);

    addressInput.value = inputUrl;
    currentTab.el.querySelector(".tab-title").textContent = inputUrl;
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
                localStorage.setItem("delta_bookmarks", JSON.stringify(bookmarks));
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

    tabEl.innerHTML = `
        <span class="tab-title">New Tab</span>
        <button class="tab-close">x</button>
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
        currentUrl: url
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
            if (t.iframe.container) t.iframe.container.style.display = "none";
            else t.iframe.frame.style.display = "none";
        }
    });

    if (current.iframe) {
        if (current.iframe.container) current.iframe.container.style.display = "block";
        else current.iframe.frame.style.display = "block";
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
        if (tab.iframe.container) tab.iframe.container.remove();
        else tab.iframe.frame.remove();
        // clear any loading interval
        if (tab._loadingInterval) clearInterval(tab._loadingInterval);
    }

    tabs.splice(index, 1);

    if (tabs.length) switchTab(tabs[Math.max(0, index - 1)].id);
    else createTab();
}

// --- FRAME INJECTION ---
function setupFrameInjection(frame) {
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
function attachLoadingBarToTab(tab) {
    if (!tab?.iframe?.container) return;
    const wrapper = tab.iframe.container;

    // create bar
    let bar = wrapper.querySelector('.frame-loading-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'frame-loading-bar';
        Object.assign(bar.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            height: '4px',
            width: '0%',
            background: 'linear-gradient(90deg, #ffffff, #f5f5f5)',
            transition: 'width 200ms ease-out, opacity 300ms ease',
            zIndex: 50,
            pointerEvents: 'none',
            opacity: '1'
        });
        wrapper.appendChild(bar);
    }

    // on iframe load finish
    try {
        tab.iframe.frame.addEventListener('load', () => {
            setLoadingPercent(tab, 100);
            setTimeout(() => {
                if (bar) bar.style.opacity = '0';
            }, 300);
            if (tab._loadingInterval) { clearInterval(tab._loadingInterval); tab._loadingInterval = null; }
        });
    } catch (e) {
        // ignore
    }
}

function setLoadingPercent(tab, pct) {
    const wrapper = tab?.iframe?.container;
    if (!wrapper) return;
    const bar = wrapper.querySelector('.frame-loading-bar');
    if (!bar) return;
    bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function startLoadingSimulation(tab) {
    if (!tab?.iframe?.container) return;
    const wrapper = tab.iframe.container;
    const bar = wrapper.querySelector('.frame-loading-bar');
    if (!bar) return;

    // reset
    bar.style.opacity = '1';
    setLoadingPercent(tab, 3);

    // gradually increase to a random cap below 85%
    let cap = 60 + Math.floor(Math.random() * 20); // 60-79
    let current = 3;
    if (tab._loadingInterval) clearInterval(tab._loadingInterval);
    tab._loadingInterval = setInterval(() => {
        if (current < cap) {
            current += Math.random() * 6; // increment by up to 6
            setLoadingPercent(tab, current);
        } else {
            // slowly nudge up a bit
            current += Math.random() * 2;
            setLoadingPercent(tab, Math.min(current, cap + 5));
        }
    }, 250);
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

    localStorage.setItem("delta_bookmarks", JSON.stringify(bookmarks));
    renderBookmarks();
    updateBookmarkIcon();
};

inspectBtn.onclick = () => {
    const t = tabs.find(x => x.id === activeTabId);
    if (t?.iframe) {
        t.iframe.frame.contentWindow.postMessage("toggle-eruda", "*");
    }
};

document.getElementById("nav-reload").onclick = () =>
    tabs.find(t => t.id === activeTabId)?.iframe?.frame.contentWindow.location.reload();

document.getElementById("nav-back").onclick = () =>
    tabs.find(t => t.id === activeTabId)?.iframe?.frame.contentWindow.history.back();

document.getElementById("nav-forward").onclick = () =>
    tabs.find(t => t.id === activeTabId)?.iframe?.frame.contentWindow.history.forward();

// --- START ---
renderBookmarks();
createTab();

// --- PROXY STATUS INDICATOR & SMOKE TEST ---
function updateProxyIndicator(name) {
    const bar = document.getElementById('nav-bar');
    if (!bar) return;
    let el = document.getElementById('proxy-status');
    if (!el) {
        el = document.createElement('div');
        el.id = 'proxy-status';
        Object.assign(el.style, { color: 'var(--text-dim)', padding: '0 0.6rem', fontSize: '0.9rem', alignSelf: 'center' });
        bar.insertBefore(el, bar.firstChild);
    }
    el.textContent = `Proxy: ${name}`;
}

window.runProxySmokeTest = async function(timeout = 8000) {
    console.log('Running proxy smoke test...');
    const backends = Object.keys(proxyManager.backends);
    const results = {};
    const original = localStorage.getItem('delta_proxy') || 'scramjet';

    for (const b of backends) {
        try {
            if (proxySelect) proxySelect.value = b;
            await proxyManager.setProxy(b);
            updateProxyIndicator(b);

            // open a new tab and navigate
            createTab();
            const t = tabs[tabs.length - 1];
            const testUrl = 'example.com';
            navigateToUrl(testUrl);

            // wait for iframe load or timeout
            const ok = await new Promise((res) => {
                const start = Date.now();
                const check = () => {
                    if (t.iframe && t.iframe.frame && (t.iframe.frame.contentWindow || t.iframe.frame.src)) return res(true);
                    if (Date.now() - start > timeout) return res(false);
                    setTimeout(check, 200);
                };
                check();
            });

            results[b] = ok ? 'loaded' : 'timeout';
            // close the test tab
            closeTab(t.id);
        } catch (e) {
            results[b] = 'error:' + (e && e.message ? e.message : String(e));
        }
    }

    // restore original
    if (proxySelect) proxySelect.value = original;
    await proxyManager.setProxy(original);
    updateProxyIndicator(original);

    console.log('Proxy smoke test results:', results);
    return results;
};