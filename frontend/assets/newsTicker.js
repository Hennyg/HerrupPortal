// assets/newsTicker.js
// Nyhedsbjælke (som DR's "LIVE"-bjælke): gul bjælke med en label og tekst der
// kører. Kan vises øverst i "Velkommen"-tile'n og/eller i stedet for den blå
// linje under navbaren. Styres af bannerfelterne på nyheden.
(function () {
  "use strict";

  const DEFAULT_COLOR = "#FFD400";

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

  function segmentHTML(b, withLabel) {
    const text = [b.overskrift, b.indhold].filter(Boolean).join(" – ");
    const label = withLabel ? `<span class="tickerInlineLabel">${esc(b.tekst)}</span>` : "";
    return `<span class="tickerSeg">${label}${esc(text)}</span>`;
  }

  function tickerHTML(list) {
    const first = list[0];
    const color = /^#[0-9a-f]{6}$/i.test(first.farve || "") ? first.farve : DEFAULT_COLOR;
    const fg = textColorFor(color);
    const isLive = /live/i.test(first.tekst);
    const href = list.length === 1 && first.hasBody ? `/nyhed.html?id=${encodeURIComponent(first.id)}` : "/nyheder.html";
    // Andre bannere med en anden label får deres egen label i teksten
    const segs = list.map((b, i) => segmentHTML(b, i > 0 && b.tekst !== first.tekst)).join('<span class="tickerDot">●</span>');
    return `
      <a class="newsTicker" href="${href}" style="--ticker-bg:${esc(color)};--ticker-fg:${fg}">
        <span class="tickerLabel">${isLive ? '<span class="tickerLive"></span>' : ""}${esc(first.tekst)}</span>
        <span class="tickerTrack">
          <span class="tickerMove">
            <span class="tickerCopy">${segs}<span class="tickerDot">●</span></span>
            <span class="tickerCopy" aria-hidden="true">${segs}<span class="tickerDot">●</span></span>
          </span>
        </span>
      </a>`;
  }

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
  }

  // banners: array fra /api/tips → { id, tekst, farve, tile, navbar, overskrift, indhold, hasBody }
  function render(banners, { tile = true } = {}) {
    const list = Array.isArray(banners) ? banners.filter(b => b && b.tekst) : [];
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

  window.HerrupTicker = { render, load, preview };
})();
