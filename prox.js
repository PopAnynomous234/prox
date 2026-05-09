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

// Modal Elements
const addBookmarkBtn = document.getElementById("nav-add-bookmark");
const bookmarkModal = document.getElementById("bookmark-modal");
const bmSaveBtn = document.getElementById("bm-save");
const bmCancelBtn = document.getElementById("bm-cancel");
const bmNameInput = document.getElementById("bm-name");
const bmUrlInput = document.getElementById("bm-url");

let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let bookmarks = JSON.parse(localStorage.getItem("delta_bookmarks") || "[]");

// --- ⚡ SPEED CORE: INITIALIZATION ---
const { ScramjetController } = $scramjetLoadController();
const scramjet = new ScramjetController({
    prefix: "/shuttle/",
    files: { 
        wasm: "/prox/scram/scramjet.wasm.wasm", 
        all: "/prox/scram/scramjet.all.js", 
        sync: "/prox/scram/scramjet.sync.js" 
    },
    memory: 1024 
});
scramjet.init();

const connection = new BareMux.BareMuxConnection("/prox/baremux/worker.js");

// PRE-WARM ENGINE: Register SW and Transport immediately on load
const proxyWarmup = (async () => {
    try {
        // Start SW registration in background
        if ('serviceWorker' in navigator) {
            await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            await navigator.serviceWorker.ready;
        }
        
        const wispUrls = [
            location.protocol === "https:" ? "wss://wisp.rhw.one/" : "ws://wisp.rhw.one/",
            (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/"
        ];

        let transportConnected = false;
        for (const wispUrl of wispUrls) {
            try {
                await connection.setTransport("/prox/epoxy/index.mjs", [{ wisp: wispUrl }]);
                transportConnected = true;
                break;
            } catch (_transportErr) {}
        }

        if (!transportConnected) {
            throw new Error("Unable to connect to any Wisp transport endpoint.");
        }
        console.log("🚀 Proxy Engine: HOT & UDP Ready");
    } catch (e) {
        console.error("Proxy Warm-up failed:", e);
    }
})();

// --- Navigation Logic ---
async function navigateToUrl(inputUrl) {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab) return;

    try {
        await proxyWarmup;
    } catch (_err) {
        // Continue so users can still navigate even if warm-up partially fails.
    }
    
    // Convert input to proxied URL (search.js)
    const url = search(inputUrl, searchEngine.value);

    if (!currentTab.iframe) {
        const frame = scramjet.createFrame();
        frame.frame.classList.add('sj-frame');
        
        // Optimization: Instant sizing to prevent layout shift
        Object.assign(frame.frame.style, {
            border: "none",
            width: "100%",
            height: "100%",
            margin: "0",
            padding: "0",
            display: "block"
        });

        currentTab.contentEl.style.display = "none";
        webviewContainer.appendChild(frame.frame);
        currentTab.iframe = frame;
        setupFrameInjection(frame);
    } 

    currentTab.iframe.frame.style.display = 'block';
    currentTab.currentUrl = inputUrl;
    
    // Execute navigation immediately (transport is already warm)
    currentTab.iframe.go(url);
    
    // UI Updates
    addressInput.value = inputUrl;
    currentTab.el.querySelector('.tab-title').textContent = inputUrl;
    updateBookmarkIcon();
}

// --- Bookmark & UI Logic ---
function renderBookmarks() {
    bookmarkBar.innerHTML = "";
    const fragment = document.createDocumentFragment(); // Faster DOM insertion

    bookmarks.forEach(bm => {
        const div = document.createElement("div");
        div.className = "bookmark-item";
        
        const isJS = bm.url.startsWith("javascript:");
        const iconUrl = isJS 
            ? "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2326ff9a'><path d='M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93M4 15c0 4.42 3.58 8 8 8s8-3.58 8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z'/></svg>" 
            : `https://www.google.com/s2/favicons?domain=${bm.url}&sz=32`;

        div.innerHTML = `<img src="${iconUrl}" class="bookmark-icon" loading="lazy"><span>${bm.title}</span>`;
        
        div.onclick = () => {
            if (isJS) {
                const t = tabs.find(x => x.id === activeTabId);
                if (t?.iframe?.frame) {
                    try {
                        const targetDoc = t.iframe.frame.contentWindow.document;
                        const code = decodeURIComponent(bm.url.replace("javascript:", ""));
                        const script = targetDoc.createElement('script');
                        script.textContent = `(function(){ ${code} })();`;
                        targetDoc.documentElement.appendChild(script);
                        script.remove();
                    } catch (err) { alert("Security block: Site rejects injection."); }
                }
            } else {
                navigateToUrl(bm.url);
            }
        };
        
        div.oncontextmenu = (e) => {
            e.preventDefault();
            if(confirm("Delete bookmark?")) {
                bookmarks = bookmarks.filter(b => b.url !== bm.url);
                localStorage.setItem("delta_bookmarks", JSON.stringify(bookmarks));
                renderBookmarks();
            }
        };
        fragment.appendChild(div);
    });
    bookmarkBar.appendChild(fragment);
}

// --- Tab Management ---
function createTab(url = null) {
    tabCounter++;
    const tabId = tabCounter;
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.id = tabId;
    tabEl.innerHTML = `<span class="tab-title">New Tab</span><button class="tab-close"><i class="fa-solid fa-xmark"></i></button>`;
    
    tabEl.onclick = (e) => { if(!e.target.closest('.tab-close')) switchTab(tabId); };
    tabEl.querySelector('.tab-close').onclick = (e) => { e.stopPropagation(); closeTab(tabId); };
    tabsStrip.insertBefore(tabEl, addTabBtn);

    const contentEl = homeTemplate.cloneNode(true);
    contentEl.id = `content-${tabId}`;
    contentEl.style.display = "none";
    webviewContainer.appendChild(contentEl);

    tabs.push({ id: tabId, el: tabEl, contentEl: contentEl, iframe: null, currentUrl: url });
    switchTab(tabId);
    if(url) navigateToUrl(url);
}

function switchTab(id) {
    activeTabId = id;
    const currentTab = tabs.find(t => t.id === id);
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    currentTab.el.classList.add('active');
    
    tabs.forEach(t => {
        t.contentEl.style.display = "none";
        if (t.iframe) t.iframe.frame.style.display = "none";
    });

    if (currentTab.iframe) {
        currentTab.iframe.frame.style.display = "block";
    } else {
        currentTab.contentEl.style.display = "flex";
    }
    addressInput.value = currentTab.currentUrl || "";
    updateBookmarkIcon();
}

function closeTab(id) {
    const index = tabs.findIndex(t => t.id === id);
    if (index === -1) return;
    const tab = tabs[index];
    tab.el.remove();
    tab.contentEl.remove();
    if(tab.iframe) tab.iframe.frame.remove();
    tabs.splice(index, 1);
    if (activeTabId === id && tabs.length > 0) switchTab(tabs[Math.max(0, index - 1)].id);
    else if (tabs.length === 0) createTab();
}

// --- Injections & Controls ---
function setupFrameInjection(frame) {
    frame.frame.onload = () => {
        try {
            const win = frame.frame.contentWindow;
            const innerDoc = win.document;
            if (!innerDoc.getElementById('eruda-loader')) {
                const script = innerDoc.createElement('script');
                script.id = 'eruda-loader';
                script.src = "https://cdn.jsdelivr.net/npm/eruda";
                script.onload = () => {
                    win.eruda.init();
                    win.eruda._entryBtn.hide();
                    win.erudaToggleState = false;
                    win.addEventListener('message', (e) => {
                        if (e.data === 'toggle-eruda') {
                            win.erudaToggleState ? win.eruda.hide() : win.eruda.show();
                            win.erudaToggleState = !win.erudaToggleState;
                        }
                    });
                };
                innerDoc.head.appendChild(script);
            }
        } catch (e) { console.warn("Injection blocked by site CSP."); }
    };
}

// Modal logic
addBookmarkBtn.onclick = (e) => {
    e.preventDefault();
    const currentTab = tabs.find(t => t.id === activeTabId);
    bmNameInput.value = currentTab ? currentTab.el.querySelector('.tab-title').textContent : "";
    bmUrlInput.value = currentTab ? currentTab.currentUrl : "";
    bookmarkModal.style.display = "flex";
};
bmCancelBtn.onclick = () => { bookmarkModal.style.display = "none"; };
bmSaveBtn.onclick = () => {
    if (bmNameInput.value && bmUrlInput.value) {
        bookmarks.push({ title: bmNameInput.value, url: bmUrlInput.value });
        localStorage.setItem("delta_bookmarks", JSON.stringify(bookmarks));
        renderBookmarks();
        bookmarkModal.style.display = "none";
        updateBookmarkIcon();
    }
};

function toggleBookmark() {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab?.currentUrl) return;
    const url = currentTab.currentUrl;
    const index = bookmarks.findIndex(b => b.url === url);
    if (index !== -1) bookmarks.splice(index, 1);
    else {
        let title = prompt("Bookmark Name:", url.split('/')[0]);
        if(title) bookmarks.push({ url, title: title.substring(0, 15) });
    }
    localStorage.setItem("delta_bookmarks", JSON.stringify(bookmarks));
    renderBookmarks();
    updateBookmarkIcon();
}

function updateBookmarkIcon() {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab?.currentUrl) return;
    const isBookmarked = bookmarks.some(b => b.url === currentTab.currentUrl);
    bookmarkBtn.querySelector('i').className = isBookmarked ? "fa-solid fa-star" : "fa-regular fa-star";
}

// --- Event Listeners ---
form.onsubmit = (e) => { e.preventDefault(); navigateToUrl(addressInput.value); };
addTabBtn.onclick = () => createTab();
bookmarkBtn.onclick = () => toggleBookmark();
inspectBtn.onclick = () => {
    const t = tabs.find(x => x.id === activeTabId);
    if (t?.iframe) t.iframe.frame.contentWindow.postMessage('toggle-eruda', '*');
};
document.getElementById("nav-reload").onclick = () => tabs.find(x => x.id === activeTabId)?.iframe?.frame.contentWindow.location.reload();
document.getElementById("nav-back").onclick = () => tabs.find(x => x.id === activeTabId)?.iframe?.frame.contentWindow.history.back();
document.getElementById("nav-forward").onclick = () => tabs.find(x => x.id === activeTabId)?.iframe?.frame.contentWindow.history.forward();

// Start
renderBookmarks();
createTab();