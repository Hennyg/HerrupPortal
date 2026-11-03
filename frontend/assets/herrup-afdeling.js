// assets/herrup-afdeling.js
//
// Tilføjer fanen "Afdeling" i personkortet på herrup.html efter "Kalender"
// (samme mønster som herrup-kalender.js). Viser hele personens afdeling side
// om side som mødelokale-oversigten i Flyveborde: personer som kolonner,
// halve timer som rækker, med dagvælger.
//
// Kun farvekoder - ledig / optaget / arbejder andetsteds. Ingen mødeinfo.
// Fraværende og foreløbig vises som optaget.
//
// Er der for mange personer til at navnene kan stå vandret, drejes de 90°.
// Klik på et navn åbner den persons kort.
//
// Data: /api/department-calendar?user=<id>&date=YYYY-MM-DD
(() => {
  const TZ = "Europe/Copenhagen";
  const CACHE_MS = 2 * 60 * 1000;
  const MIN_COL_HORIZONTAL = 90;  // px pr. kolonne før navnene drejes
  const MIN_COL_VERTICAL = 26;    // px pr. kolonne med drejede navne
  const TIME_COL = 52;

  // Statuskoder fra getSchedule -> visning
  const CODE = {
    "0": "free",
    "1": "busy",   // foreløbig
    "2": "busy",
    "3": "busy",   // fraværende
    "4": "away"    // arbejder andetsteds
  };
  const TEXT = { free: "Ledig", busy: "Optaget", away: "Arbejder andetsteds", unknown: "Ukendt" };
  const WEEKDAYS = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];

  const cache = new Map(); // "<userId>|<date>" -> { at, data }
  let panel = null, button = null, loadSeq = 0;
  let date = null, lastUserId = null, lastData = null;

  // ---------- Hjælpere ----------
  const pad2 = n => String(n).padStart(2, "0");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const nowLocal = () => new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date()).replace(" ", "T");
  const todayIso = () => nowLocal().slice(0, 10);

  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  }
  function weekday(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }
  function dkDate(iso) { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; }
  function minToHhmm(min) { return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`; }

  function currentUser() {
    // herrup.html har "let currentModalUser" på øverste niveau i sit script
    try { return typeof currentModalUser !== "undefined" ? currentModalUser : null; } catch { return null; }
  }

  // ---------- Styling (farver som Flyveborde) ----------
  function injectCss() {
    if (document.getElementById("herrupAfdCss")) return;
    const st = document.createElement("style");
    st.id = "herrupAfdCss";
    st.textContent = `
      .ha-nav { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
      .ha-nav button { border:1px solid #d1d5db; background:#fff; border-radius:6px; padding:.3rem .6rem; cursor:pointer; font-weight:700; min-width:34px; }
      .ha-nav button:hover { background:#f3f4f6; }
      .ha-nav input { border:1px solid #d1d5db; border-radius:6px; padding:.25rem .4rem; }
      .ha-nav .lbl { font-weight:700; color:#2c3e50; margin-left:6px; }
      .ha-legend { display:flex; gap:14px; flex-wrap:wrap; margin:4px 0 3px; font-size:.8rem; color:#374151; }
      .ha-legend i { display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
      .ha-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; transition:opacity .15s; }
      .ha-wrap.loading { opacity:.5; pointer-events:none; }
      table.ha-sched { border-collapse:separate; border-spacing:2px; width:100%; table-layout:fixed; }
      table.ha-sched th { font-size:.8rem; color:#2c3e50; font-weight:700; padding:4px 2px; text-align:center;
                          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:bottom; }
      table.ha-sched th.time { width:${TIME_COL - 6}px; text-align:right; padding-right:6px; color:#6b7280; font-weight:600; vertical-align:middle; }
      table.ha-sched th.col { cursor:pointer; }
      table.ha-sched th.col:hover { color:#850c18; text-decoration:underline; }
      table.ha-sched th.col.me { color:#850c18; }
      table.ha-sched.vertical th.col { height:130px; padding:4px 0; }
      table.ha-sched.vertical th.col .nm { display:inline-block; writing-mode:vertical-rl; transform:rotate(180deg);
                                           max-height:126px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      table.ha-sched td { height:20px; border-radius:4px; padding:0; }
      table.ha-sched tr.hour-start td { box-shadow: inset 0 1px 0 rgba(0,0,0,.06); }
      td.ha-free    { background:#dbeafe; }
      td.ha-busy    { background:repeating-linear-gradient(45deg, rgba(255,255,255,.18) 0 6px, transparent 6px 12px), #c2410c; }
      td.ha-away    { background:radial-gradient(rgba(255,255,255,.35) 1.5px, transparent 1.6px) 0 0/7px 7px, #0f766e; }
      td.ha-unknown { background:#e5e7eb; }
      td.ha-past    { opacity:.45; }
      .ha-legend .free    { background:#dbeafe; border:1px solid #1e3a8a; box-sizing:border-box; }
      .ha-legend .busy    { background:repeating-linear-gradient(45deg, rgba(255,255,255,.18) 0 4px, transparent 4px 8px), #c2410c; }
      .ha-legend .away    { background:radial-gradient(rgba(255,255,255,.35) 1.5px, transparent 1.6px) 0 0/5px 5px, #0f766e; }
      .ha-legend .unknown { background:#e5e7eb; }
      .ha-empty { padding:1.2rem 0; color:#6b7280; }
    `;
    document.head.appendChild(st);
  }

  // ---------- Fane ----------
  function addModalTab() {
    const tabs = document.querySelector(".modal-tabs");
    const body = document.querySelector(".modal-body");
    if (!tabs || !body || document.getElementById("mtAfdeling")) return;
    // Afdeling skal stå efter Kalender - vent til Kalender-fanen findes
    if (!document.getElementById("mtKalender")) return;

    injectCss();

    button = document.createElement("button");
    button.className = "modal-tab";
    button.id = "mtAfdeling";
    button.type = "button";
    button.textContent = "Afdeling";
    tabs.appendChild(button);

    panel = document.createElement("div");
    panel.className = "modal-tab-panel";
    panel.id = "panelAfdeling";
    body.appendChild(panel);

    // Når herrup.html (eller de andre faner) skifter fane, skal Afdeling slukkes
    const original = window.switchModalTab;
    if (typeof original === "function" && !window.__afdSwitchWrapped) {
      window.__afdSwitchWrapped = true;
      window.switchModalTab = function switchModalTabAfdeling(tab) {
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
      const u = currentUser();
      if (!date || u?.id !== lastUserId) date = todayIso(); // ny person -> start på i dag
      load();
    });

    // Navigation og klik på navne (event-delegation, panelets indhold genopbygges)
    panel.addEventListener("click", e => {
      const nav = e.target.closest("button[data-shift]");
      if (nav) { date = addDays(date, Number(nav.dataset.shift)); load(); return; }
      if (e.target.closest("button[data-today]")) { date = todayIso(); load(); return; }
      const th = e.target.closest("th.col[data-id]");
      if (th && typeof window.openModal === "function" && th.dataset.id !== currentUser()?.id) {
        window.openModal(th.dataset.id);
      }
    });
    panel.addEventListener("change", e => {
      if (e.target.matches("input[data-date]") && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
        date = e.target.value; load();
      }
    });

    let rt = null;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (panel.classList.contains("active")) fitColumns(); }, 120);
    });
  }

  // ---------- Data ----------
  async function load() {
    const u = currentUser();
    if (!u?.id) { panel.innerHTML = `<div class="ha-empty">Ingen person valgt.</div>`; return; }

    const key = `${u.id}|${date}`;
    const seq = ++loadSeq;
    const sameUser = u.id === lastUserId;
    lastUserId = u.id;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) { render(hit.data); return; }

    // Behold det gamle gitter (nedtonet) ved dagskift, så modalen ikke hopper
    const wrap = panel.querySelector(".ha-wrap");
    if (sameUser && wrap) {
      wrap.classList.add("loading");
      const lbl = panel.querySelector(".ha-nav .lbl");
      if (lbl) lbl.textContent = `${weekday(date)} ${dkDate(date)}`;
      const inp = panel.querySelector("input[data-date]");
      if (inp) inp.value = date;
    } else {
      panel.innerHTML = `<div class="stateMsg" style="padding:1.5rem 0;"><div class="spinner"></div><div>Henter afdelingens kalendere…</div></div>`;
    }

    try {
      const r = await fetch(`/api/department-calendar?user=${encodeURIComponent(u.id)}&date=${date}`, { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (seq !== loadSeq) return;
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      cache.set(key, { at: Date.now(), data });
      render(data);
    } catch (e) {
      if (seq !== loadSeq) return;
      const msg = e instanceof TypeError
        ? "Forbindelsen til portalen blev afbrudt – din login-session er sandsynligvis udløbet. Genindlæs siden."
        : e.message;
      panel.innerHTML = `${navHtml()}<div class="ha-empty">Kunne ikke hente afdelingen: ${esc(msg)}</div>`;
    }
  }

  // ---------- Tegn ----------
  function navHtml() {
    return `
      <div class="ha-nav">
        <button type="button" data-shift="-7" title="En uge tilbage">«</button>
        <button type="button" data-shift="-1" title="En dag tilbage">‹</button>
        <input type="date" data-date value="${esc(date)}">
        <button type="button" data-shift="1" title="En dag frem">›</button>
        <button type="button" data-shift="7" title="En uge frem">»</button>
        <button type="button" data-today>I dag</button>
        <span class="lbl">${esc(weekday(date))} ${esc(dkDate(date))}</span>
      </div>`;
  }

  function render(data) {
    lastData = data;
    const people = data.people || [];
    const me = currentUser()?.id;

    if (!data.department) {
      panel.innerHTML = `${navHtml()}<div class="ha-empty">Personen er ikke tilknyttet en afdeling.</div>`;
      return;
    }
    if (!people.length) {
      panel.innerHTML = `${navHtml()}<div class="ha-empty">Ingen kolleger fundet i afdelingen ${esc(data.department)}.</div>`;
      return;
    }

    const startMin = data.startHour * 60, step = data.stepMin;
    const slots = ((data.endHour - data.startHour) * 60) / step;
    const now = nowLocal();
    const today = now.slice(0, 10);
    const nowMin = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16));

    let html = `<table class="ha-sched"><thead><tr><th class="time"></th>`;
    for (const p of people) {
      html += `<th class="col ${p.id === me ? "me" : ""}" data-id="${esc(p.id)}" title="${esc(p.name)}${p.jobTitle ? ` – ${esc(p.jobTitle)}` : ""}"><span class="nm">${esc(p.name)}</span></th>`;
    }
    html += `</tr></thead><tbody>`;

    for (let i = 0; i < slots; i++) {
      const s = startMin + i * step, e = s + step;
      const isHour = s % 60 === 0;
      const past = data.date < today || (data.date === today && e <= nowMin);
      html += `<tr class="${isHour ? "hour-start" : ""}"><th class="time">${isHour ? minToHhmm(s) : ""}</th>`;
      for (const p of people) {
        const st = p.view ? (CODE[p.view[i]] || "unknown") : "unknown";
        const tip = `${p.name} ${minToHhmm(s)}–${minToHhmm(e)}: ${p.error && !p.view ? p.error : TEXT[st]}`;
        html += `<td class="ha-${st}${past ? " ha-past" : ""}" title="${esc(tip)}"></td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;

    panel.innerHTML = `
      ${navHtml()}
      <div class="ha-legend">
        <span><i class="free"></i>Ledig</span>
        <span><i class="busy"></i>Optaget</span>
        <span><i class="away"></i>Arbejder andetsteds</span>
      </div>
      <div class="ha-wrap">${html}</div>`;

    fitColumns();
  }

  // Vandrette navne hvis der er plads, ellers drejet 90°. Er der stadig
  // ikke plads, scroller tabellen vandret.
  function fitColumns() {
    const wrap = panel?.querySelector(".ha-wrap");
    const table = wrap?.querySelector("table.ha-sched");
    if (!table || !lastData?.people?.length) return;
    const n = lastData.people.length;
    const perCol = (wrap.clientWidth - TIME_COL) / n;
    const vertical = perCol < MIN_COL_HORIZONTAL;
    table.classList.toggle("vertical", vertical);
    const minW = TIME_COL + n * (vertical ? MIN_COL_VERTICAL : MIN_COL_HORIZONTAL);
    table.style.minWidth = vertical && perCol < MIN_COL_VERTICAL ? `${minW}px` : "";
  }

  document.addEventListener("DOMContentLoaded", () => {
    addModalTab();
    // Modalens markup kan blive genopbygget - sørg for at fanen altid findes
    new MutationObserver(() => addModalTab()).observe(document.documentElement, { childList: true, subtree: true });
  });
})();
