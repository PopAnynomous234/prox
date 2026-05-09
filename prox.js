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

let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let bookmarks = JSON.parse(localStorage.getItem("delta_bookmarks") || "[]");

// --- SCRAMJET INIT ---
const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
    files: {
        wasm: "/prox/scram/scramjet.wasm.wasm",
        all: "/prox/scram/scramjet.all.js",
        sync: "/prox/scram/scramjet.sync.js"
    }
});

scramjet.init();
scramjet.route = "/scramjet/";

const connection = new BareMux.BareMuxConnection("/prox/baremux/worker.js");

// --- PREWARM ---
(async () => {
    try {
        if ("serviceWorker" in navigator) {
            await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        }

        const wispUrl = "wss://wisp.rhw.one/";
        await connection.setTransport("/prox/libcurl/index.mjs", [{ wisp: wispUrl }]);

        console.log("🚀 Proxy Engine Ready");
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

    // create frame if needed
    if (!currentTab.iframe) {
        const frame = scramjet.createFrame();
        frame.frame.classList.add("sj-frame");

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

    currentTab.iframe.frame.style.display = "block";
    currentTab.currentUrl = inputUrl;

    // FIXED SCRAMJET CALL (no manual /scramjet/ prefix)
    currentTab.iframe.go(scramjet.createUrl(url));

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
        if (t.iframe) t.iframe.frame.style.display = "none";
    });

    if (current.iframe) {
        current.iframe.frame.style.display = "block";
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
    if (tab.iframe) tab.iframe.frame.remove();

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