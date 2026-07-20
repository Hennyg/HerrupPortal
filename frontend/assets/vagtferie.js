// frontend/assets/vagtferie.js
// Kan bruges både på /vagtferie.html og senere som komponent i herrup.html.

(function(){
  const MONTHS = ["Januar","Februar","Marts","April","Maj","Juni","Juli","August","September","Oktober","November","December"];
  const DAYS = ["Søn","Man","Tir","Ons","Tor","Fre","Lør"];

  function esc(s){
    return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
  }

  function qs(name){
    return new URLSearchParams(location.search).get(name) || "";
  }

  function codeClass(code){
    const c = String(code || "").trim().replace(/[^a-zA-Z0-9]/g, "");
    return c ? `vf-code-${c}` : "vf-code-other";
  }

  function badge(code, title){
    const cls = codeClass(code);
    const known = ["vf-code-T","vf-code-N","vf-code-W","vf-code-F","vf-code-FF","vf-code-A","vf-code-S","vf-code-SB","vf-code-K","vf-code-B","vf-code-H","vf-code-L","vf-code-O","vf-code-M"].includes(cls);
    return `<span class="vf-badge ${known ? cls : "vf-code-other"}" title="${esc(title || code)}">${esc(code)}</span>`;
  }

  function fmtDate(iso){
    const d = new Date(`${iso}T00:00:00`);
    return `${String(d.getDate()).padStart(2,"0")} ${MONTHS[d.getMonth()].slice(0,3)}`;
  }

  function dayName(iso){
    const d = new Date(`${iso}T00:00:00`);
    return DAYS[d.getDay()];
  }

  function apiUrl(state){
    const p = new URLSearchParams();
    p.set("year", state.year);
    p.set("month", state.month);
    p.set("limit", "40");
    if (state.employee) p.set("employee", state.employee);
    if (state.sheet) p.set("sheet", state.sheet);
    return `/api/vagtferieplan?${p.toString()}`;
  }

  async function load(state){
    const r = await fetch(apiUrl(state), { cache:"no-store" });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
    if (!r.ok) throw new Error(data?.message || data?.error || `API fejl ${r.status}`);
    return data;
  }

  function groupAreas(employees){
    return Array.from(new Set((employees || []).map(e => e.area).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"da"));
  }

  function renderMonthDays(days, year, month){
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const mondayIndex = (first.getDay() + 6) % 7;
    const byDate = new Map((days || []).map(d => [d.date, d]));
    let html = "";

    for (let i = 0; i < mondayIndex; i++) html += `<div class="vf-mini-day is-empty"></div>`;

    for (let day = 1; day <= last.getDate(); day++) {
      const iso = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const x = byDate.get(iso);
      html += `<div class="vf-mini-day">
        <div class="vf-mini-number">${day}</div>
        ${x ? badge(x.code, x.text) : ""}
      </div>`;
    }

    return html;
  }

  function renderEmployeeButtons(data, state){
    const area = state.area || "";
    const q = (state.search || "").toLowerCase();
    const rows = (data.employees || [])
      .filter(e => !area || e.area === area)
      .filter(e => !q || `${e.name} ${e.area}`.toLowerCase().includes(q));

    if (!rows.length) return `<div class="vf-muted">Ingen medarbejdere fundet</div>`;

    return rows.map(e => `<button class="vf-employee-btn ${e.name === data.selectedEmployee.name ? "active" : ""}" data-vf-employee="${esc(e.name)}">
      <div class="vf-employee-name">${esc(e.name)}</div>
      <div class="vf-employee-area">${esc(e.area)}</div>
    </button>`).join("");
  }

  function render(data, state){
    const e = data.selectedEmployee;
    const current = e.current;
    const monthDays = (e.days || []).filter(d => d.month === Number(state.month));
    const upcoming = (e.upcoming || []).slice(0, 14);
    const areas = groupAreas(data.employees);

    return `<div class="vf-shell">
      <aside class="vf-side">
        <div class="vf-toolbar">
          <select id="vfArea">
            <option value="">Alle områder</option>
            ${areas.map(a => `<option value="${esc(a)}" ${state.area === a ? "selected" : ""}>${esc(a)}</option>`).join("")}
          </select>
          <input id="vfSearch" type="search" placeholder="Søg medarbejder" value="${esc(state.search)}">
        </div>
        <div class="vf-employee-list" id="vfEmployees">${renderEmployeeButtons(data, state)}</div>
      </aside>

      <main class="vf-main">
        <div class="vf-head">
          <div>
            <h2 class="vf-title">${esc(e.name)}</h2>
            <div class="vf-muted">${esc(e.area)} · Ark: ${esc(data.source.sheetName)} · ${esc(data.source.fileName || "Excel")}</div>
          </div>
          <div class="vf-toolbar">
            <select id="vfMonth">
              ${MONTHS.map((m,i) => `<option value="${i+1}" ${(i+1) === Number(state.month) ? "selected" : ""}>${m}</option>`).join("")}
            </select>
            <select id="vfYear">
              ${[state.year-1,state.year,state.year+1].map(y => `<option value="${y}" ${y === state.year ? "selected" : ""}>${y}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="vf-status-card">
          <div class="vf-label">Nuværende status</div>
          <div class="vf-current">
            ${current ? `${badge(current.code, current.text)} <span>${esc(current.text)}</span>` : `<span class="vf-muted">Ingen markering i dag</span>`}
          </div>
        </div>

        <div class="vf-grid-2">
          <section>
            <h3 class="vf-section-title">Kommende 14 markeringer</h3>
            <div class="vf-upcoming">
              ${upcoming.length ? upcoming.map(x => `<div class="vf-row">
                <div><div class="vf-date">${fmtDate(x.date)}</div><div class="vf-day">${dayName(x.date)}</div></div>
                <div>${esc(x.text)}</div>
                <div>${badge(x.code, x.text)}</div>
              </div>`).join("") : `<div class="vf-muted">Ingen kommende markeringer</div>`}
            </div>
          </section>

          <section>
            <h3 class="vf-section-title">Opsummering ${esc(state.year)}</h3>
            <div class="vf-summary">
              ${(e.summary || []).length ? e.summary.map(x => `<div class="vf-summary-item">${badge(x.code, x.text)} <span>${esc(x.text)}: <b>${x.count}</b></span></div>`).join("") : `<div class="vf-muted">Ingen data</div>`}
            </div>

            <h3 class="vf-section-title" style="margin-top:18px;">${MONTHS[state.month-1]} ${state.year}</h3>
            <div class="vf-mini-month">
              ${["Man","Tir","Ons","Tor","Fre","Lør","Søn"].map(d => `<div class="vf-muted" style="text-align:center;font-weight:700;">${d}</div>`).join("")}
              ${renderMonthDays(monthDays, state.year, state.month)}
            </div>
          </section>
        </div>

        <div class="vf-legend">
          ${Object.entries(data.legend || {}).map(([c,t]) => `<div class="vf-summary-item">${badge(c,t)} <span>${esc(t)}</span></div>`).join("")}
        </div>
      </main>
    </div>`;
  }

  async function start(container, options){
    const now = new Date();
    const state = {
      year: Number(options.year || qs("year") || now.getFullYear()),
      month: Number(options.month || qs("month") || now.getMonth() + 1),
      employee: String(options.employee || qs("employee") || ""),
      sheet: String(options.sheet || qs("sheet") || ""),
      area: String(options.area || ""),
      search: ""
    };

    async function refresh(){
      container.innerHTML = `<div class="vf-loading">Henter vagt- og ferieplan...</div>`;
      try {
        const data = await load(state);
        if (!state.employee && data.selectedEmployee?.name) state.employee = data.selectedEmployee.name;
        container.innerHTML = render(data, state);

        container.querySelectorAll("[data-vf-employee]").forEach(btn => {
          btn.addEventListener("click", () => {
            state.employee = btn.getAttribute("data-vf-employee") || "";
            refresh();
          });
        });

        container.querySelector("#vfArea")?.addEventListener("change", ev => {
          state.area = ev.target.value;
          container.querySelector("#vfEmployees").innerHTML = renderEmployeeButtons(data, state);
          container.querySelectorAll("[data-vf-employee]").forEach(btn => {
            btn.addEventListener("click", () => {
              state.employee = btn.getAttribute("data-vf-employee") || "";
              refresh();
            });
          });
        });

        container.querySelector("#vfSearch")?.addEventListener("input", ev => {
          state.search = ev.target.value || "";
          container.querySelector("#vfEmployees").innerHTML = renderEmployeeButtons(data, state);
          container.querySelectorAll("[data-vf-employee]").forEach(btn => {
            btn.addEventListener("click", () => {
              state.employee = btn.getAttribute("data-vf-employee") || "";
              refresh();
            });
          });
        });

        container.querySelector("#vfMonth")?.addEventListener("change", ev => {
          state.month = Number(ev.target.value);
          refresh();
        });

        container.querySelector("#vfYear")?.addEventListener("change", ev => {
          state.year = Number(ev.target.value);
          state.sheet = String(state.year);
          refresh();
        });
      } catch (err) {
        container.innerHTML = `<div class="vf-error"><b>Kunne ikke hente vagt-/ferieplan.</b><br>${esc(err.message)}</div>`;
      }
    }

    await refresh();
  }

  window.renderVagtFerie = function(containerOrSelector, options = {}){
    const el = typeof containerOrSelector === "string" ? document.querySelector(containerOrSelector) : containerOrSelector;
    if (!el) return;
    start(el, options);
  };

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("vagtFerieRoot");
    if (root) window.renderVagtFerie(root, window.VAGT_FERIE_OPTIONS || {});
  });
})();
