(() => {
"use strict";

// prox.js attached its own change/click listeners to these. Cloning drops them,
// so the popup's Save is the only thing that applies changes.
const fresh = (id) => {
    const el = document.getElementById(id);
    const c = el.cloneNode(true);
    el.replaceWith(c);
    return c;
};
const searchSel = fresh("search-engine-selector");
const engineSel = fresh("engine-selector");
const wispInput = fresh("wisp-url-input");
const saveBtn = fresh("wisp-save-btn");

const settingsBtn = document.getElementById("settings-btn");
const modal = document.getElementById("settings-modal");
const cancelBtn = document.getElementById("settings-cancel");
const radios = document.querySelectorAll('input[name="wisp-choice"]');

function syncWispUI() {
    const choice = document.querySelector('input[name="wisp-choice"]:checked')?.value;
    wispInput.style.display = choice === "custom" ? "block" : "none";
}

function openSettings() {
    // proxyEngine, currentSearchEngine, wispUrl come from prox.js
    searchSel.value = currentSearchEngine;
    engineSel.value = proxyEngine;

    const preset = [...radios].find(r => r.value === wispUrl);
    if (preset) {
        preset.checked = true;
        wispInput.value = "";
    } else {
        document.querySelector('input[value="custom"]').checked = true;
        wispInput.value = wispUrl;
    }
    syncWispUI();
    modal.style.display = "flex";
}

const closeSettings = () => { modal.style.display = "none"; };

radios.forEach(r => r.addEventListener("change", syncWispUI));
settingsBtn.addEventListener("click", openSettings);
cancelBtn.addEventListener("click", closeSettings);
modal.addEventListener("click", (e) => { if (e.target === modal) closeSettings(); });
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display !== "none") closeSettings();
});

saveBtn.addEventListener("click", async () => {
    const choice = document.querySelector('input[name="wisp-choice"]:checked').value;
    const newWisp = (choice === "custom" ? wispInput.value : choice).trim();

    if (!/^wss?:\/\/.+/i.test(newWisp)) {
        alert("Enter a valid Wisp server URL starting with ws:// or wss://");
        wispInput.focus();
        return;
    }

    const newEngine = engineSel.value;
    const engineChanged = newEngine !== proxyEngine;

    localStorage.setItem("custom_wisp_url", newWisp);
    localStorage.setItem("proxy_engine", newEngine);
    localStorage.setItem("search_engine", searchSel.value);

    try {
        const cache = await caches.open("nebula-config");
        await cache.put("engine-preference", new Response(
            JSON.stringify({ engine: newEngine }),
            { headers: { "Content-Type": "application/json" } }
        ));
    } catch (e) { console.error("Cache update failed:", e); }

    if (engineChanged && navigator.serviceWorker) {
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        } catch (e) { console.error("SW unregister failed:", e); }
    }

    location.reload();
});

// --- fixes for things in prox.js ---

// wrong DuckDuckGo URL
searchEngines.duckduckgo = "https://duckduckgo.com/?q=%s";

// Lucide swaps <i> for <svg>, so the old querySelector("i") version never worked
updateBookmarkIcon = function () {
    const t = tabs.find(x => x.id === activeTabId);
    bookmarkBtn.classList.toggle("active", !!t?.currentUrl && bookmarks.some(b => b.url === t.currentUrl));
};
updateBookmarkIcon();

// same problem for the fullscreen icon
document.addEventListener("fullscreenchange", () => {
    fullscreenToggle.innerHTML = `<i data-lucide="${document.fullscreenElement ? "minimize-2" : "maximize-2"}"></i>`;
    lucide.createIcons({ attrs: { width: 16, height: 16, "stroke-width": 2 } });
});

// nothing listens for "toggle-eruda", so toggle eruda directly
inspectBtn.onclick = () => {
    const w = tabs.find(x => x.id === activeTabId)?.iframe?.frame?.contentWindow;
    if (!w?.eruda) return;
    w.__erudaOpen = !w.__erudaOpen;
    w.__erudaOpen ? w.eruda.show() : w.eruda.hide();
};
})();