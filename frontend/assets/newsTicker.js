// assets/newsTicker.js
// Nyhedsbjælke (som DR's "LIVE"-bjælke): gul bjælke med en label og tekst der
// kører. Kan vises øverst i "Velkommen"-tile'n og/eller i stedet for den blå
// linje under navbaren. Styres af bannerfelterne på nyheden.
//
// Kører flere nyheder i bjælken, har hver nyhed sin egen farve: teksten kører
// på sin egen farve, og bjælken + labelen til venstre skifter til farven og
// labelen for den nyhed, der er ved at køre ind under labelen. Klik på
// bjælken åbner den nyhed, man klikker på.
(function () {
  "use strict";

  const DEFAULT_COLOR = "#FFD400";

  function colorOf(b) { return /^#[0-9a-f]{6}$/i.test(b?.farve || "") ? b.farve : DEFAULT_COLOR; }
  function hrefOf(b)  { return b?.hasBody ? `/nyhed.html?id=${encodeURIComponent(b.id)}` : "/nyheder.html"; }

  // Lidt ekstra CSS til farve pr. nyhed (resten ligger i app.css)
  (function injectCss() {
    if (document.getElementById("tickerColorCss")) return;
    const st = document.createElement("style");
    st.id = "tickerColorCss";
    st.textContent = `
      .newsTicker { transition: background-color .35s ease, color .35s ease; }
      .newsTicker .tickerTrack, .newsTicker .tickerMove, .newsTicker .tickerCopy { align-items: stretch; }
      .tickerBlock { display:inline-flex; align-items:center; background:var(--seg-bg); color:var(--seg-fg); }
      .tickerBlock .tickerSeg { padding-left:4px; }
    `;
    (document.head || document.documentElement).appendChild(st);
  })();

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  // Sort eller hvid tekst afhængigt af baggrundens lyshed
  function textColorFor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return "#111";
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? "#111" : "#fff";
  }

  // ── "Set" pr. bruger (i denne browser) ─────────────────────────────────
  // Når brugeren har åbnet nyheden, vises dens bjælke ikke længere for
  // brugeren. Ændres nyheden (ny modifiedon), vises bjælken igen.
  const SEEN_KEY = "herrup-banner-seen";
  function readSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {}; } catch { return {}; }
  }
  function writeSeen(map) {
    // Behold kun de 100 nyeste
    const entries = Object.entries(map).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 100);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* ignoreres */ }
  }
  function markSeen(id, version) {
    if (!id) return;
    const map = readSeen();
    map[id] = { v: version || "", at: Date.now() };
    writeSeen(map);
  }
  function resetSeen(id) {
    const map = readSeen();
    delete map[id];
    writeSeen(map);
    resetViews(id);   // "Vis bjælken igen for mig" nulstiller også besøgstælleren
  }
  function isSeen(b) {
    const e = readSeen()[b.id];
    return !!e && e.v === (b.modifiedon || "");
  }

  // ── Antal besøg på forsiden pr. bjælke (i denne browser) ─────────────────
  // Har bjælken en grænse (b.max), vises den de første X gange forsiden åbnes,
  // efter nyheden er lagt op eller rettet (ny modifiedon nulstiller tælleren).
  // Gemmes som { id: { v, n, at } } – højst 100 nyheder, så det fylder intet.
  const VIEWS_KEY = "herrup-banner-views";
  const countedNow = new Set();   // tæl kun én gang pr. sidevisning
  function readViews() {
    try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || "{}") || {}; } catch { return {}; }
  }
  function writeViews(map) {
    const entries = Object.entries(map).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 100);
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* ignoreres */ }
  }
  function viewsOf(b, map = readViews()) {
    const e = map[b.id];
    return e && e.v === (b.modifiedon || "") ? (e.n || 0) : 0;
  }
  function isUsedUp(b) {
    return Number(b.max) > 0 && viewsOf(b) >= Number(b.max);
  }
  // Kaldes på forsiden: tæl et besøg for hver bjælke med grænse, der vises nu
  function countVisit(list) {
    const map = readViews();
    let changed = false;
    for (const b of list) {
      if (!(Number(b.max) > 0) || countedNow.has(b.id)) continue;
      countedNow.add(b.id);
      map[b.id] = { v: b.modifiedon || "", n: viewsOf(b, map) + 1, at: Date.now() };
      changed = true;
    }
    if (changed) writeViews(map);
  }
  function resetViews(id) {
    const map = readViews();
    delete map[id];
    writeViews(map);
  }

  // Én nyhed i bjælken: teksten + prikken efter, på nyhedens egen farve
  function blockHTML(b) {
    const color = colorOf(b);
    const text = [b.overskrift, b.indhold].filter(Boolean).join(" – ");
    return `<span class="tickerBlock" style="--seg-bg:${esc(color)};--seg-fg:${textColorFor(color)}"
        data-label="${esc(b.tekst)}" data-color="${esc(color)}" data-href="${esc(hrefOf(b))}">
        <span class="tickerSeg">${esc(text)}</span><span class="tickerDot">●</span></span>`;
  }

  function labelHTML(tekst) {
    return `${/live/i.test(tekst) ? '<span class="tickerLive"></span>' : ""}${esc(tekst)}`;
  }

  function tickerHTML(list) {
    const first = list[0];
    const color = colorOf(first);
    const blocks = list.map(blockHTML).join("");
    return `
      <a class="newsTicker" href="${esc(hrefOf(first))}" style="--ticker-bg:${esc(color)};--ticker-fg:${textColorFor(color)}">
        <span class="tickerLabel">${labelHTML(first.tekst)}</span>
        <span class="tickerTrack">
          <span class="tickerMove">
            <span class="tickerCopy">${blocks}</span>
            <span class="tickerCopy" aria-hidden="true">${blocks}</span>
          </span>
        </span>
      </a>`;
  }

  // Bjælken og labelen følger den nyhed, der er under labelens højre kant
  const tracked = new Set();
  let trackRaf = null;
  function track(root) {
    const a = root.querySelector(".newsTicker");
    if (!a || a.querySelectorAll(".tickerCopy:first-child .tickerBlock").length < 2) return;
    tracked.add(a);
    if (!trackRaf) trackRaf = requestAnimationFrame(trackLoop);
  }
  function trackLoop() {
    for (const a of [...tracked]) {
      if (!a.isConnected) { tracked.delete(a); continue; }
      const x = a.querySelector(".tickerTrack").getBoundingClientRect().left + 2;
      let cur = null;
      for (const blk of a.querySelectorAll(".tickerBlock")) {
        const r = blk.getBoundingClientRect();
        if (r.left <= x && r.right > x) { cur = blk; break; }
      }
      if (!cur || a.__cur === cur.dataset.color + "|" + cur.dataset.label) continue;
      a.__cur = cur.dataset.color + "|" + cur.dataset.label;
      a.style.setProperty("--ticker-bg", cur.dataset.color);
      a.style.setProperty("--ticker-fg", textColorFor(cur.dataset.color));
      const lbl = a.querySelector(".tickerLabel");
      if (lbl && lbl.dataset.label !== cur.dataset.label) {
        lbl.dataset.label = cur.dataset.label;
        lbl.innerHTML = labelHTML(cur.dataset.label);
      }
      a.href = cur.dataset.href;
    }
    trackRaf = tracked.size ? requestAnimationFrame(trackLoop) : null;
  }

  // Klik åbner den nyhed, man klikker på (ellers den der er under labelen)
  document.addEventListener("click", (e) => {
    const blk = e.target.closest?.(".newsTicker .tickerBlock[data-href]");
    if (blk) blk.closest(".newsTicker").href = blk.dataset.href;
  }, true);

  // Tilpas hastigheden til tekstens længde (ca. 70 px/sek)
  function setSpeed(root) {
    requestAnimationFrame(() => {
      root.querySelectorAll(".tickerMove").forEach(el => {
        const copy = el.querySelector(".tickerCopy");
        const w = copy ? copy.scrollWidth : 600;
        el.style.animationDuration = `${Math.max(12, Math.round(w / 70))}s`;
      });
    });
  }

  function renderNav(list) {
    const bar = document.querySelector(".navbar .nav-accent");
    if (!bar) return;
    if (!list.length) {
      bar.classList.remove("hasTicker");
      bar.innerHTML = "";
      return;
    }
    bar.classList.add("hasTicker");
    bar.innerHTML = tickerHTML(list);
    setSpeed(bar);
    track(bar);
  }

  function renderTile(list) {
    const title = document.getElementById("newsTitle");
    if (!title) return;
    const host = title.parentElement;
    let slot = document.getElementById("tileTicker");
    if (!list.length) { slot?.remove(); return; }
    if (!slot) {
      slot = document.createElement("div");
      slot.id = "tileTicker";
      slot.className = "tileTicker";
      host.insertBefore(slot, host.firstChild);
    }
    slot.innerHTML = tickerHTML(list);
    setSpeed(slot);
    track(slot);
  }

  // banners: array fra /api/tips → { id, tekst, farve, tile, navbar, overskrift, indhold, hasBody }
  // tile = true betyder forsiden – kun der tælles besøg
  function render(banners, { tile = true } = {}) {
    const list = Array.isArray(banners)
      ? banners.filter(b => b && b.tekst && !isSeen(b) && (countedNow.has(b.id) || !isUsedUp(b)))
      : [];
    if (tile) countVisit(list);
    renderNav(list.filter(b => b.navbar));
    if (tile) renderTile(list.filter(b => b.tile));
  }

  // Til sider uden tip-tile: hent selv og vis kun bjælken under navbaren
  async function load() {
    try {
      const r = await fetch("/api/tips", { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      render(data?.banners || [], { tile: false });
    } catch { /* bjælken er ikke kritisk */ }
  }

  // Forhåndsvisning i redigeringssiden
  function preview(el, banner) {
    if (!el) return;
    if (!banner || !banner.tekst) { el.innerHTML = ""; return; }
    el.innerHTML = tickerHTML([banner]);
    el.querySelector("a")?.addEventListener("click", e => e.preventDefault());
    setSpeed(el);
  }

  window.HerrupTicker = { render, load, preview, markSeen, resetSeen };
})();
