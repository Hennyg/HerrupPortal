// assets/herrup-kalender.js
//
// Tilføjer fanen "Kalender" i personkortet på herrup.html (samme mønster som
// "Vagt/Ferie" i herrup-vagtferie.js). Viser personens dag som en tidslinje:
// kun tidspunkter, status og kategorier med farver - aldrig mødeemner.
// Data: /api/person-calendar?user=<id>&date=YYYY-MM-DD
(() => {
  const TZ = "Europe/Copenhagen";
  const HOUR_PX = 44;            // højde pr. time i tidslinjen
  const DEFAULT_START = 7;       // tidslinjen viser mindst 07-17 ...
  const DEFAULT_END = 17;        // ... og udvides hvis der er møder udenfor
  const CACHE_MS = 2 * 60 * 1000;

  const SHOW_AS = {
    busy:             { text: "Optaget",             color: "#4f6bed" },
    tentative:        { text: "Foreløbig",           color: "#9aa9f0" },
    oof:              { text: "Ikke til stede",      color: "#8764b8" },
    workingElsewhere: { text: "Arbejder andetsteds", color: "#30c6cc" },
    free:             { text: "Ledig",               color: "#c8ccd4" },
    unknown:          { text: "Optaget",             color: "#4f6bed" }
  };
  const WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
  const MONTHS = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];

  const cache = new Map(); // "<userId>|<date>" -> { at, data }
  let panel = null, button = null, loadSeq = 0;

  // ---------- Hjælpere ----------
  const pad2 = n => String(n).padStart(2, "0");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const nowLocal = () => new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date()).replace(" ", "T");
  const todayIso = () => nowLocal().slice(0, 10);
  const minutesOf = iso => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
  const hhmm = iso => iso.slice(11, 16);

  function dkLong(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${wd.charAt(0).toUpperCase() + wd.slice(1)} ${d}. ${MONTHS[m - 1]} ${y}`;
  }

  // Sort eller hvid tekst afhængigt af baggrundens lysstyrke
  function textOn(hex) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return "#fff";
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? "#1f2937" : "#fff";
  }

  function currentUser() {
    // herrup.html har "let currentModalUser" på øverste niveau i sit script
    try { return typeof currentModalUser !== "undefined" ? currentModalUser : null; } catch { return null; }
  }

  // ---------- Styling ----------
  function injectCss() {
    if (document.getElementById("herrupKalCss")) return;
    const st = document.createElement("style");
    st.id = "herrupKalCss";
    st.textContent = `
      .hk-head { display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; }
      .hk-date { font-weight:700; color:#2c3e50; font-size:1.05rem; }
      .hk-muted { color:#6b7280; font-size:.85rem; }
      .hk-allday { display:flex; flex-direction:column; gap:4px; margin-top:8px; }
      .hk-allday .hk-ev { position:static; }
      .hk-timeline { position:relative; margin-top:10px; border-top:1px solid rgba(0,0,0,.08); }
      .hk-hour { position:absolute; left:0; right:0; border-top:1px solid rgba(0,0,0,.06); }
      .hk-hour span { position:absolute; left:0; top:-.6em; width:42px; text-align:right; font-size:.72rem; color:#6b7280; background:#fff; padding-right:6px; }
      .hk-lanes { position:absolute; left:52px; right:0; top:0; bottom:0; }
      .hk-ev { position:absolute; border-radius:6px; padding:3px 7px; font-size:.78rem; line-height:1.2; overflow:hidden;
               box-shadow:0 1px 3px rgba(0,0,0,.12); border:1px solid rgba(0,0,0,.08); }
      .hk-ev .t { font-weight:700; }
      .hk-ev.tentative { background-image:repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 6px, transparent 6px 12px); }
      .hk-chip { display:inline-block; padding:0 6px; border-radius:8px; font-size:.7rem; font-weight:600; margin:2px 3px 0 0; }
      .hk-now { position:absolute; left:46px; right:0; border-top:2px solid #c30a14; z-index:2; }
      .hk-now::before { content:""; position:absolute; left:-5px; top:-5px; width:8px; height:8px; border-radius:50%; background:#c30a14; }
      .hk-legend { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:12px; font-size:.8rem; color:#374151; }
      .hk-legend i { display:inline-block; width:11px; height:11px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
      .hk-empty { padding:1.2rem 0; color:#6b7280; }
    `;
    document.head.appendChild(st);
  }

  // ---------- Fane ----------
  function addModalTab() {
    const tabs = document.querySelector(".modal-tabs");
    const body = document.querySelector(".modal-body");
    if (!tabs || !body || document.getElementById("mtKalender")) return;

    injectCss();

    button = document.createElement("button");
    button.className = "modal-tab";
    button.id = "mtKalender";
    button.type = "button";
    button.textContent = "Kalender";
    tabs.appendChild(button);

    panel = document.createElement("div");
    panel.className = "modal-tab-panel";
    panel.id = "panelKalender";
    body.appendChild(panel);

    // Når herrup.html (eller Vagt/Ferie) skifter fane, skal Kalender slukkes
    const original = window.switchModalTab;
    if (typeof original === "function" && !window.__kalSwitchWrapped) {
      window.__kalSwitchWrapped = true;
      window.switchModalTab = function switchModalTabKalender(tab) {
        panel.classList.remove("active");
        button.classList.remove("active");
        original(tab);
      };
    }

    button.addEventListener("click", () => {
      document.querySelectorAll(".modal-tab, .herrup-vf-tab-btn").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".modal-tab-panel").forEach(p => p.classList.remove("active"));
      button.classList.add("active");
      panel.classList.add("active");
      load();
    });
  }

  // ---------- Data ----------
  async function load() {
    const u = currentUser();
    if (!u?.id) { panel.innerHTML = `<div class="hk-empty">Ingen person valgt.</div>`; return; }

    const date = todayIso();
    const key = `${u.id}|${date}`;
    const seq = ++loadSeq;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) { render(hit.data); return; }

    panel.innerHTML = `<div class="stateMsg" style="padding:1.5rem 0;"><div class="spinner"></div><div>Henter kalender…</div></div>`;
    try {
      const r = await fetch(`/api/person-calendar?user=${encodeURIComponent(u.id)}&date=${date}`, { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (seq !== loadSeq) return;
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      cache.set(key, { at: Date.now(), data });
      render(data);
    } catch (e) {
      if (seq !== loadSeq) return;
      panel.innerHTML = `<div class="hk-empty">Kunne ikke hente kalenderen: ${esc(e.message)}</div>`;
    }
  }

  // ---------- Tegn ----------
  function colorOf(ev) {
    return ev.categories?.[0]?.color || (SHOW_AS[ev.showAs] || SHOW_AS.unknown).color;
  }

  function eventHtml(ev, style) {
    const bg = colorOf(ev);
    const fg = textOn(bg);
    const status = (SHOW_AS[ev.showAs] || SHOW_AS.unknown).text;
    const time = ev.isAllDay ? "Hele dagen" : `${hhmm(ev.start)}–${hhmm(ev.end)}`;
    const chips = (ev.categories || []).slice(1).map(c =>
      `<span class="hk-chip" style="background:${esc(c.color)};color:${textOn(c.color)}">${esc(c.name)}</span>`).join("");
    const first = ev.categories?.[0]?.name;
    const label = [time, first || status, ev.isPrivate ? "Privat" : ""].filter(Boolean).join(" · ");
    const title = [time, status, ...(ev.categories || []).map(c => c.name), ev.isPrivate ? "Privat" : ""].filter(Boolean).join(" · ");
    return `<div class="hk-ev ${esc(ev.showAs)}" style="${style}background-color:${esc(bg)};color:${fg}" title="${esc(title)}">
      <span class="t">${esc(label)}</span>${chips ? `<div>${chips}</div>` : ""}
    </div>`;
  }

  // Fordel overlappende møder i baner side om side
  function layoutLanes(list) {
    const items = list.map(ev => ({ ev, s: minutesOf(ev.start), e: Math.max(minutesOf(ev.end) || 1440, minutesOf(ev.start) + 15) }))
      .sort((a, b) => a.s - b.s || b.e - a.e);
    const groups = [];
    let cur = null;
    for (const it of items) {
      if (!cur || it.s >= cur.end) { cur = { items: [], end: it.e }; groups.push(cur); }
      cur.items.push(it);
      cur.end = Math.max(cur.end, it.e);
    }
    for (const g of groups) {
      const laneEnds = [];
      for (const it of g.items) {
        let lane = laneEnds.findIndex(end => end <= it.s);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.e); } else laneEnds[lane] = it.e;
        it.lane = lane;
      }
      g.items.forEach(it => { it.lanes = laneEnds.length; });
    }
    return items;
  }

  function render(data) {
    const date = data.date;
    const all = data.events || [];
    // Møder der starter i går/slutter i morgen klippes til dagen
    const timed = all.filter(e => !e.isAllDay).map(e => ({
      ...e,
      start: e.start.slice(0, 10) < date ? `${date}T00:00:00` : e.start,
      end: e.end.slice(0, 10) > date ? `${date}T23:59:00` : e.end
    }));
    const allDay = all.filter(e => e.isAllDay);

    let startH = DEFAULT_START, endH = DEFAULT_END;
    for (const e of timed) {
      startH = Math.min(startH, Math.floor(minutesOf(e.start) / 60));
      endH = Math.max(endH, Math.ceil(minutesOf(e.end) / 60));
    }
    endH = Math.min(24, Math.max(endH, startH + 1));
    const height = (endH - startH) * HOUR_PX;
    const top = m => ((m - startH * 60) / 60) * HOUR_PX;

    let hours = "";
    for (let h = startH; h <= endH; h++) hours += `<div class="hk-hour" style="top:${top(h * 60)}px"><span>${pad2(h)}:00</span></div>`;

    const lanes = layoutLanes(timed).map(it => {
      const y = top(it.s), h = Math.max(18, top(it.e) - y - 2);
      const w = 100 / it.lanes;
      return eventHtml(it.ev, `top:${y}px;height:${h}px;left:calc(${w * it.lane}% + 2px);width:calc(${w}% - 4px);`);
    }).join("");

    const now = nowLocal();
    const nowM = minutesOf(now);
    const nowLine = now.slice(0, 10) === date && nowM >= startH * 60 && nowM <= endH * 60
      ? `<div class="hk-now" style="top:${top(nowM)}px" title="Nu ${hhmm(now)}"></div>` : "";

    // Forklaring: de kategorier og statusser der faktisk forekommer
    const legend = new Map();
    for (const e of all) {
      if (e.categories?.length) e.categories.forEach(c => legend.set(c.name, c.color));
      else { const s = SHOW_AS[e.showAs] || SHOW_AS.unknown; legend.set(s.text, s.color); }
    }

    panel.innerHTML = `
      <div>
        <div class="hk-head">
          <div class="hk-date">${esc(dkLong(date))}</div>
          <div class="hk-muted">${all.length ? `${all.length} aftale${all.length === 1 ? "" : "r"}` : ""}</div>
        </div>
        ${all.length ? "" : `<div class="hk-empty">Ingen aftaler i kalenderen i dag.</div>`}
        ${allDay.length ? `<div class="hk-allday">${allDay.map(e => eventHtml(e, "")).join("")}</div>` : ""}
        <div class="hk-timeline" style="height:${height}px">
          ${hours}
          <div class="hk-lanes">${lanes}</div>
          ${nowLine}
        </div>
        ${legend.size ? `<div class="hk-legend">${[...legend].map(([n, c]) => `<span><i style="background:${esc(c)}"></i>${esc(n)}</span>`).join("")}</div>` : ""}
      </div>`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    addModalTab();
    // Modalens markup kan blive genopbygget - sørg for at fanen altid findes
    new MutationObserver(() => addModalTab()).observe(document.documentElement, { childList: true, subtree: true });
  });
})();
