(function(){
  const MONTHS = ["Januar","Februar","Marts","April","Maj","Juni","Juli","August","September","Oktober","November","December"];
  const DAYS = ["Søn","Man","Tir","Ons","Tor","Fre","Lør"];
  const yearCache = new Map();

  function esc(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
  function norm(s){ return String(s ?? "").replace(/\s+/g," ").trim().toLowerCase(); }
  function qs(name){ return new URLSearchParams(location.search).get(name) || ""; }
  function todayIso(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function codeClass(code){ const c = String(code || "").trim().replace(/[^a-zA-Z0-9]/g, ""); return c ? `vf-code-${c}` : "vf-code-other"; }
  function badge(code, title){
    const cls = codeClass(code);
    const known = ["vf-code-T","vf-code-N","vf-code-W","vf-code-F","vf-code-FF","vf-code-A","vf-code-S","vf-code-SB","vf-code-K","vf-code-B","vf-code-H","vf-code-L","vf-code-O","vf-code-M"].includes(cls);
    return `<span class="vf-badge ${known ? cls : "vf-code-other"}" title="${esc(title || code)}">${esc(code)}</span>`;
  }
  function fmtDate(iso){ const d = new Date(`${iso}T00:00:00`); return `${String(d.getDate()).padStart(2,"0")} ${MONTHS[d.getMonth()].slice(0,3)}`; }
  function dayName(iso){ return DAYS[new Date(`${iso}T00:00:00`).getDay()]; }

  function apiUrl(state, refresh){
    const p = new URLSearchParams();
    p.set("year", state.year);
    if (state.sheet) p.set("sheet", state.sheet);
    if (refresh) p.set("refresh", "1");
    return `/api/vagtferieplan?${p.toString()}`;
  }

  async function loadYear(state, refresh){
    const key = `${state.year}|${state.sheet || state.year}`;
    if (!refresh && yearCache.has(key)) return yearCache.get(key);
    const r = await fetch(apiUrl(state, refresh), { cache:"no-store" });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
    if (!r.ok) throw new Error(data?.message || data?.error || `API fejl ${r.status}`);
    yearCache.set(key, data);
    return data;
  }

  function groupAreas(employees){ return Array.from(new Set((employees || []).map(e => e.area).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"da")); }
  function groupSections(employees){ return Array.from(new Set((employees || []).map(e => e.section || e.area).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"da")); }

  function filteredEmployees(data, state){
    const q = norm(state.search);
    return (data.employees || [])
      .filter(e => !state.section || (e.section || e.area) === state.section)
      .filter(e => !state.area || e.area === state.area)
      .filter(e => !q || `${e.name} ${e.area} ${e.section || ""}`.toLowerCase().includes(q));
  }

  function findEmployee(data, state){
    const list = filteredEmployees(data, state);
    if (!list.length) return null;
    if (!state.employee) return list[0];
    const q = norm(state.employee);
    return list.find(e => norm(e.name) === q) || list.find(e => norm(e.name).includes(q)) || list[0];
  }

  function summarize(days, year, legend){
    const counts = new Map();
    for (const d of days || []) if (Number(d.year) === Number(year)) counts.set(d.code, (counts.get(d.code) || 0) + 1);
    return Array.from(counts.entries()).sort((a,b)=>String(a[0]).localeCompare(String(b[0]),"da")).map(([code,count]) => ({ code, count, text: (legend || {})[code] || code }));
  }

  function monthDaysFor(employee, year, month){ return (employee?.days || []).filter(d => Number(d.year) === Number(year) && Number(d.month) === Number(month)); }
  function upcomingFor(employee, today, limit){ return (employee?.days || []).filter(d => d.date >= today).slice(0, limit); }
  function currentFor(employee, today){ return (employee?.days || []).find(d => d.date === today) || null; }

  function renderMonthDays(days, year, month){
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const pad = (first.getDay() + 6) % 7;
    const byDate = new Map((days || []).map(d => [d.date, d]));
    let html = "";
    for (let i = 0; i < pad; i++) html += `<div class="vf-mini-day is-empty"></div>`;
    for (let day = 1; day <= last.getDate(); day++) {
      const iso = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const x = byDate.get(iso);
      html += `<div class="vf-mini-day"><div class="vf-mini-number">${day}</div>${x ? badge(x.code, x.text) : ""}</div>`;
    }
    return html;
  }

  function renderEmployeeButtons(data, state, selectedName){
    const rows = filteredEmployees(data, state);
    if (!rows.length) return `<div class="vf-muted">Ingen medarbejdere fundet</div>`;
    return rows.map(e => `<button class="vf-employee-btn ${e.name === selectedName ? "active" : ""}" data-vf-employee="${esc(e.name)}"><div class="vf-employee-name">${esc(e.name)}</div><div class="vf-employee-area">${esc(e.area)}${e.section && e.section !== e.area ? ` · ${esc(e.section)}` : ""}</div></button>`).join("");
  }

  function render(data, state){
    const employee = findEmployee(data, state);
    if (!employee) return `<div class="vf-error">Ingen medarbejdere fundet i arket.</div>`;
    state.employee = employee.name;
    const today = data.today || todayIso();
    const current = currentFor(employee, today);
    const upcoming = upcomingFor(employee, today, 14);
    const monthDays = monthDaysFor(employee, state.year, state.month);
    const summary = summarize(employee.days || [], state.year, data.legend || {});
    const sections = groupSections(data.employees);
    const areas = groupAreas(data.employees);
    const cacheText = data.cache?.hit ? "server-cache" : "ny læsning";

    return `<div class="vf-shell">
      <aside class="vf-side">
        <div class="vf-toolbar">
          <select id="vfSection"><option value="">Alle afdelinger</option>${sections.map(a => `<option value="${esc(a)}" ${state.section === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
          <select id="vfArea"><option value="">Alle områder</option>${areas.map(a => `<option value="${esc(a)}" ${state.area === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
          <input id="vfSearch" type="search" placeholder="Søg medarbejder" value="${esc(state.search)}">
        </div>
        <div class="vf-muted" style="margin-bottom:8px;">${(data.employees || []).length} medarbejdere indlæst · ${esc(cacheText)}</div>
        <div class="vf-employee-list" id="vfEmployees">${renderEmployeeButtons(data, state, employee.name)}</div>
      </aside>
      <main class="vf-main">
        <div class="vf-head">
          <div><h2 class="vf-title">${esc(employee.name)}</h2><div class="vf-muted">${esc(employee.area)}${employee.section && employee.section !== employee.area ? ` · ${esc(employee.section)}` : ""} · Ark: ${esc(data.source?.sheetName || state.year)} · ${esc(data.source?.fileName || "Excel")}</div></div>
          <div class="vf-toolbar">
            <select id="vfMonth">${MONTHS.map((m,i) => `<option value="${i+1}" ${(i+1) === Number(state.month) ? "selected" : ""}>${m}</option>`).join("")}</select>
            <select id="vfYear">${[state.year-1,state.year,state.year+1].map(y => `<option value="${y}" ${y === state.year ? "selected" : ""}>${y}</option>`).join("")}</select>
            <button class="btn" id="vfRefresh" type="button">Opdater data</button>
          </div>
        </div>
        <div class="vf-status-card"><div class="vf-label">Nuværende status</div><div class="vf-current">${current ? `${badge(current.code, current.text)} <span>${esc(current.text)}</span>` : `<span class="vf-muted">Ingen markering i dag</span>`}</div></div>
        <div class="vf-grid-2">
          <section><h3 class="vf-section-title">Kommende 14 markeringer</h3><div class="vf-upcoming">${upcoming.length ? upcoming.map(x => `<div class="vf-row"><div><div class="vf-date">${fmtDate(x.date)}</div><div class="vf-day">${dayName(x.date)}</div></div><div>${esc(x.text)}</div><div>${badge(x.code, x.text)}</div></div>`).join("") : `<div class="vf-muted">Ingen kommende markeringer</div>`}</div></section>
          <section><h3 class="vf-section-title">Opsummering ${esc(state.year)}</h3><div class="vf-summary">${summary.length ? summary.map(x => `<div class="vf-summary-item">${badge(x.code, x.text)} <span>${esc(x.text)}: <b>${x.count}</b></span></div>`).join("") : `<div class="vf-muted">Ingen data</div>`}</div><h3 class="vf-section-title" style="margin-top:18px;">${MONTHS[state.month-1]} ${state.year}</h3><div class="vf-mini-month">${["Man","Tir","Ons","Tor","Fre","Lør","Søn"].map(d => `<div class="vf-muted" style="text-align:center;font-weight:700;">${d}</div>`).join("")}${renderMonthDays(monthDays, state.year, state.month)}</div></section>
        </div>
        <div class="vf-legend">${Object.entries(data.legend || {}).map(([c,t]) => `<div class="vf-summary-item">${badge(c,t)} <span>${esc(t)}</span></div>`).join("")}</div>
      </main>
    </div>`;
  }

  function wire(container, data, state, refreshFn){
    const rerender = () => { container.innerHTML = render(data, state); wire(container, data, state, refreshFn); };
    container.querySelectorAll("[data-vf-employee]").forEach(btn => btn.addEventListener("click", () => { state.employee = btn.getAttribute("data-vf-employee") || ""; rerender(); }));
    container.querySelector("#vfSection")?.addEventListener("change", e => { state.section = e.target.value; state.employee = ""; rerender(); });
    container.querySelector("#vfArea")?.addEventListener("change", e => { state.area = e.target.value; state.employee = ""; rerender(); });
    container.querySelector("#vfMonth")?.addEventListener("change", e => { state.month = Number(e.target.value); rerender(); });
    container.querySelector("#vfYear")?.addEventListener("change", e => { state.year = Number(e.target.value); state.sheet = String(state.year); state.employee = ""; state.section = ""; state.area = ""; refreshFn(false); });
    container.querySelector("#vfRefresh")?.addEventListener("click", () => refreshFn(true));
    container.querySelector("#vfSearch")?.addEventListener("input", e => { state.search = e.target.value || ""; rerender(); });
  }

  async function start(container, options){
    const now = new Date();
    const state = {
      year: Number(options.year || qs("year") || now.getFullYear()),
      month: Number(options.month || qs("month") || now.getMonth() + 1),
      employee: String(options.employee || qs("employee") || ""),
      sheet: String(options.sheet || qs("sheet") || ""),
      section: String(options.section || ""),
      area: String(options.area || ""),
      search: ""
    };
    async function refresh(force){
      container.innerHTML = `<div class="vf-loading">Henter hele årsarket...</div>`;
      try { const data = await loadYear(state, force); container.innerHTML = render(data, state); wire(container, data, state, refresh); }
      catch(err){ container.innerHTML = `<div class="vf-error"><b>Kunne ikke hente vagt-/ferieplan.</b><br>${esc(err.message)}</div>`; }
    }
    await refresh(false);
  }

  window.renderVagtFerie = function(containerOrSelector, options = {}){
    const el = typeof containerOrSelector === "string" ? document.querySelector(containerOrSelector) : containerOrSelector;
    if (el) start(el, options);
  };
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("vagtFerieRoot");
    if (root) window.renderVagtFerie(root, window.VAGT_FERIE_OPTIONS || {});
  });
})();
