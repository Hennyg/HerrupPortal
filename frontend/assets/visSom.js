// assets/visSom.js
// "Vis som"-menu til navbaren (admin.html). Kun for portal_admin.
// Åbner forsiden med ?visSom=… – selve simuleringen sker i assets/app.js:
//   mig    → egen visning
//   bruger → almindelig bruger (kun portal_user)
//   <mail> / <id> → en bestemt bruger (roller slås op i /api/simulate-roles)
(function () {
  const CSS = `
    .visSom{position:relative}
    .visSomBtn{background:none;border:0;color:var(--text-on-dark,#fff);font:inherit;cursor:pointer;opacity:.95;padding:0;display:flex;align-items:center;gap:.35rem}
    .visSomBtn:hover{opacity:1;text-decoration:underline}
    .visSomBtn .cur{font-size:.78rem;background:rgba(255,255,255,.18);border-radius:999px;padding:.1rem .5rem;text-decoration:none}
    .visSomPanel{position:absolute;right:0;top:calc(100% + 10px);width:300px;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:6px;z-index:500}
    .visSomPanel[hidden]{display:none}
    .visSomItem{display:block;width:100%;text-align:left;background:none;border:0;border-radius:8px;padding:9px 12px;font:inherit;font-size:.92rem;color:#111827;cursor:pointer}
    .visSomItem:hover,.visSomItem:focus{background:#f3f4f6;outline:none}
    .visSomItem.active{font-weight:700}
    .visSomItem.active::after{content:" ✓";color:#16a34a}
    .visSomSep{height:1px;background:#e5e7eb;margin:6px 4px}
    .visSomLabel{font-size:.78rem;font-weight:700;color:#6b7280;padding:6px 12px 4px}
    .visSomPanel .empSearch{margin:0 6px 4px}
    .visSomPanel .empSearchResults{position:static;box-shadow:none;margin-top:6px;max-height:260px;overflow-y:auto}
    .visSomPanel .empSearchResult small{display:block;color:#6b7280;font-size:.75rem}
  `;

  const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function rolesFromMe(me) {
    const fromUserRoles = (me?.userRoles || []).map(r => String(r).toLowerCase());
    const fromClaims = (me?.claims || [])
      .filter(c => { const t = String(c.typ || "").toLowerCase(); return t === "roles" || t === "role" || t.endsWith("/identity/claims/role"); })
      .map(c => String(c.val || "").toLowerCase());
    return new Set([...fromUserRoles, ...fromClaims]);
  }

  function current() {
    try { return sessionStorage.getItem("hpVisSom") || ""; } catch { return ""; }
  }

  function go(value) {
    location.href = `/?visSom=${encodeURIComponent(value)}`;
  }

  async function init() {
    const host = document.getElementById("visSomMenu");
    if (!host) return;

    let me = null;
    try {
      const r = await fetch("/.auth/me", { cache: "no-store" });
      me = (await r.json())?.clientPrincipal || null;
    } catch {}
    if (!rolesFromMe(me).has("portal_admin")) return;   // kun portal_admin

    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const cur = current();
    const curLabel = !cur ? "" : cur === "bruger" ? "kontakter" : cur.split("@")[0];

    host.className = "visSom";
    host.innerHTML = `
      <button type="button" class="visSomBtn" aria-haspopup="true" aria-expanded="false">
        Vis som ▾${curLabel ? ` <span class="cur">${esc(curLabel)}</span>` : ""}
      </button>
      <div class="visSomPanel" hidden>
        <button type="button" class="visSomItem${!cur ? " active" : ""}" data-v="mig">Vis som mig</button>
        <button type="button" class="visSomItem${cur === "bruger" ? " active" : ""}" data-v="bruger">Vis som kontakter</button>
        <div class="visSomSep"></div>
        <div class="visSomLabel">Vis som bruger</div>
        <div class="empSearch">
          <input type="search" class="empSearchInput" placeholder="Søg medarbejder…" autocomplete="off" aria-label="Søg medarbejder">
          <div class="empSearchResults" hidden></div>
        </div>
      </div>`;

    const btn = host.querySelector(".visSomBtn");
    const panel = host.querySelector(".visSomPanel");
    const input = host.querySelector(".empSearchInput");
    const results = host.querySelector(".empSearchResults");

    function open(on) {
      panel.hidden = !on;
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      if (on) setTimeout(() => input.focus(), 0);
    }
    btn.addEventListener("click", e => { e.stopPropagation(); open(panel.hidden); });
    document.addEventListener("click", e => { if (!host.contains(e.target)) open(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") open(false); });

    host.querySelectorAll(".visSomItem").forEach(b => b.addEventListener("click", () => go(b.dataset.v)));

    // ── Søgning – samme fremgangsmåde som Personaleliste-tile'n på forsiden ──
    let timer = null, fetchId = 0;

    function show(html) { results.innerHTML = html; results.hidden = false; }
    function hide() { results.hidden = true; results.innerHTML = ""; }

    async function search(q) {
      const my = ++fetchId;
      show(`<div class="empSearchInfo">Søger…</div>`);
      try {
        let list;
        const entry = typeof entraCacheRead === "function" ? await entraCacheRead() : null;
        if (entry && typeof entraCacheIsFresh === "function" && entraCacheIsFresh(entry)) {
          const ql = q.toLowerCase();
          list = entry.data
            .filter(u => (u.displayName || "").toLowerCase().includes(ql) || (u.mail || "").toLowerCase().includes(ql))
            .slice(0, 15);
        } else {
          const r = await fetch(`/api/entra-users-search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
          list = Array.isArray(data) ? data : [];
          if (typeof entraCacheWarm === "function") entraCacheWarm();
        }
        if (my !== fetchId) return;
        if (!list.length) { show(`<div class="empSearchInfo">Ingen resultater</div>`); return; }
        show(list.map(u => `
          <button type="button" class="empSearchResult" data-v="${esc((u.mail || u.id || "").toLowerCase())}">
            ${esc(u.displayName || "–")}<small>${esc(u.mail || u.jobTitle || "")}</small>
          </button>`).join(""));
        results.querySelectorAll(".empSearchResult").forEach(el =>
          el.addEventListener("click", () => go(el.dataset.v)));
      } catch (e) {
        if (my !== fetchId) return;
        show(`<div class="empSearchInfo">Kunne ikke søge: ${esc(e.message)}</div>`);
      }
    }

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { fetchId++; hide(); return; }
      timer = setTimeout(() => search(q), 200);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const first = results.querySelector(".empSearchResult");
        if (first) { e.preventDefault(); go(first.dataset.v); }
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
