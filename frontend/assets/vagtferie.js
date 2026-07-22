// frontend/assets/vagtferie.js
// Selvstændig Vagt/Ferie-side til /vagtferie.html.
// Denne version passer til API-svaret fra /api/vagtferieplan, som returnerer employees[].
// Ikke minified.

(function () {
    const MONTHS = [
        "Januar", "Februar", "Marts", "April", "Maj", "Juni",
        "Juli", "August", "September", "Oktober", "November", "December"
    ];

    const DAYS = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];
    const WEEK_DAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

    const yearCache = new Map();

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, match => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#39;"
        }[match]));
    }

    function qs(name) {
        return new URLSearchParams(location.search).get(name) || "";
    }

    function todayIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    function parseIso(iso) {
        return new Date(`${iso}T00:00:00`);
    }

    function codeClass(code) {
        const cleanCode = String(code || "").trim().replace(/[^a-zA-Z0-9]/g, "");
        return cleanCode ? `vf-code-${cleanCode}` : "vf-code-other";
    }

    function badge(code, title) {
        const cls = codeClass(code);
        return `<span class="vf-badge ${cls}" title="${esc(title || code)}">${esc(code)}</span>`;
    }

    function fmtDate(iso) {
        const d = parseIso(iso);
        return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()].slice(0, 3)}`;
    }

    function dayName(iso) {
        return DAYS[parseIso(iso).getDay()];
    }

    function apiUrl(state, refresh) {
        const p = new URLSearchParams();
        p.set("year", state.year);

        if (state.sheet) {
            p.set("sheet", state.sheet);
        }

        if (refresh) {
            p.set("refresh", "1");
        }

        return `/api/vagtferieplan?${p.toString()}`;
    }

    async function loadYear(state, refresh) {
        const key = `${state.year}|${state.sheet || state.year}`;

        if (!refresh && yearCache.has(key)) {
            return yearCache.get(key);
        }

        const response = await fetch(apiUrl(state, refresh), { cache: "no-store" });
        const text = await response.text();
        let data = null;

        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = { raw: text };
        }

        if (!response.ok) {
            throw new Error(data?.message || data?.error || `API fejl ${response.status}`);
        }

        if (!Array.isArray(data?.employees)) {
            throw new Error("API-svaret mangler employees[].");
        }

        yearCache.set(key, data);
        return data;
    }

    function groupAreas(employees) {
        return Array.from(new Set((employees || []).map(e => e.area).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, "da"));
    }

    function norm(value) {
        return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function filteredEmployees(data, state) {
        const area = state.area || "";
        const q = norm(state.search);

        return (data.employees || [])
            .filter(employee => !area || employee.area === area)
            .filter(employee => {
                if (!q) return true;
                return `${employee.name} ${employee.area} ${employee.section || ""}`.toLowerCase().includes(q);
            });
    }

    function findEmployee(data, state) {
        const rows = filteredEmployees(data, state);

        if (!rows.length) {
            return null;
        }

        if (!state.employee) {
            return rows[0];
        }

        const q = norm(state.employee);

        return rows.find(e => norm(e.name) === q)
            || rows.find(e => norm(e.name).includes(q))
            || rows[0];
    }

    function getCurrent(employee, data) {
        const today = data.today || todayIso();
        return (employee?.days || []).find(day => day.date === today) || null;
    }

    function getUpcoming(employee, data) {
        const today = data.today || todayIso();
        return (employee?.days || [])
            .filter(day => day.date >= today)
            .slice(0, 14);
    }

    function getSummary(employee, year, legend) {
        const counts = new Map();

        for (const day of employee?.days || []) {
            if (Number(day.year) === Number(year)) {
                counts.set(day.code, (counts.get(day.code) || 0) + 1);
            }
        }

        return Array.from(counts.entries())
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "da"))
            .map(([code, count]) => ({
                code,
                count,
                text: (legend || {})[code] || code
            }));
    }

    function monthDays(employee, year, month) {
        return (employee?.days || []).filter(day => {
            return Number(day.year) === Number(year) && Number(day.month) === Number(month);
        });
    }

    function renderMonthDays(days, year, month) {
        const first = new Date(year, month - 1, 1);
        const last = new Date(year, month, 0);
        const pad = (first.getDay() + 6) % 7;
        const byDate = new Map((days || []).map(day => [day.date, day]));
        let html = "";

        for (let i = 0; i < pad; i++) {
            html += `<div class="vf-mini-day is-empty"></div>`;
        }

        for (let day = 1; day <= last.getDate(); day++) {
            const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const item = byDate.get(iso);
            const d = parseIso(iso);
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;

            html += `
                <div class="vf-mini-day ${isWeekend ? "vf-weekend" : ""}">
                    <div class="vf-mini-number">${day}</div>
                    ${item ? badge(item.code, item.text) : ""}
                </div>
            `;
        }

        return html;
    }

    function renderEmployeeButtons(data, state, selectedName) {
        const rows = filteredEmployees(data, state);

        if (!rows.length) {
            return `<div class="vf-muted">Ingen medarbejdere fundet</div>`;
        }

        return rows.map(employee => `
            <button class="vf-employee-btn ${employee.name === selectedName ? "active" : ""}" type="button" data-vf-employee="${esc(employee.name)}">
                <div class="vf-employee-name">${esc(employee.name)}</div>
                <div class="vf-employee-area">${esc(employee.area)}${employee.section && employee.section !== employee.area ? ` · ${esc(employee.section)}` : ""}</div>
            </button>
        `).join("");
    }

    function render(data, state) {
        const employee = findEmployee(data, state);

        if (!employee) {
            return `<div class="vf-error">Ingen medarbejdere fundet i arket.</div>`;
        }

        if (!state.employee) {
            state.employee = employee.name;
        }

        const areas = groupAreas(data.employees);
        const current = getCurrent(employee, data);
        const upcoming = getUpcoming(employee, data);
        const summary = getSummary(employee, state.year, data.legend || {});
        const days = monthDays(employee, state.year, state.month);
        const cacheText = data.cache?.hit ? "server-cache" : "ny læsning";

        return `
            <div class="vf-shell">
                <aside class="vf-side">
                    <div class="vf-toolbar">
                        <select id="vfArea">
                            <option value="">Alle områder</option>
                            ${areas.map(area => `<option value="${esc(area)}" ${state.area === area ? "selected" : ""}>${esc(area)}</option>`).join("")}
                        </select>
                        <input id="vfSearch" type="search" placeholder="Søg medarbejder" value="${esc(state.search)}">
                    </div>

                    <div class="vf-muted" style="margin-bottom:8px;">
                        ${(data.employees || []).length} medarbejdere indlæst · ${esc(cacheText)}
                    </div>

                    <div class="vf-employee-list" id="vfEmployees">
                        ${renderEmployeeButtons(data, state, employee.name)}
                    </div>
                </aside>

                <main class="vf-main">
                    <div class="vf-head">
                        <div>
                            <h2 class="vf-title">${esc(employee.name)}</h2>
                            <div class="vf-muted">${esc(employee.area)}${employee.section && employee.section !== employee.area ? ` · ${esc(employee.section)}` : ""} · Ark: ${esc(data.source?.sheetName || state.year)} · ${esc(data.source?.fileName || "Excel")}</div>
                        </div>

                        <div class="vf-toolbar">
                            <select id="vfMonth">
                                ${MONTHS.map((month, index) => `<option value="${index + 1}" ${(index + 1) === Number(state.month) ? "selected" : ""}>${month}</option>`).join("")}
                            </select>

                            <select id="vfYear">
                                ${[state.year - 1, state.year, state.year + 1].map(year => `<option value="${year}" ${year === state.year ? "selected" : ""}>${year}</option>`).join("")}
                            </select>

                            <button class="btn" id="vfRefresh" type="button">Opdater data</button>
                        </div>
                    </div>

                    <div class="vf-status-card">
                        <div class="vf-label">Dagens status</div>
                        <div class="vf-current">
                            ${current ? `${badge(current.code, current.text)} <span>${esc(current.text)}</span>` : `<span class="vf-muted">Ingen markering i dag</span>`}
                        </div>
                    </div>

                    <div class="vf-grid-2">
                        <section>
                            <h3 class="vf-section-title">Kommende 14 markeringer</h3>
                            <div class="vf-upcoming">
                                ${upcoming.length ? upcoming.map(day => `
                                    <div class="vf-row">
                                        <div>
                                            <div class="vf-date">${fmtDate(day.date)}</div>
                                            <div class="vf-day">${dayName(day.date)}</div>
                                        </div>
                                        <div>${esc(day.text)}</div>
                                        <div>${badge(day.code, day.text)}</div>
                                    </div>
                                `).join("") : `<div class="vf-muted">Ingen kommende markeringer</div>`}
                            </div>
                        </section>

                        <section>
                            <h3 class="vf-section-title">${MONTHS[state.month - 1]} ${state.year}</h3>
                            <div class="vf-mini-month">
                                ${WEEK_DAYS.map(day => `<div class="vf-muted" style="text-align:center;font-weight:700;">${day}</div>`).join("")}
                                ${renderMonthDays(days, state.year, state.month)}
                            </div>

                            <h3 class="vf-section-title" style="margin-top:18px;">Opsummering ${esc(state.year)}</h3>
                            <div class="vf-summary">
                                ${summary.length ? summary.map(row => `
                                    <div class="vf-summary-item">
                                        ${badge(row.code, row.text)}
                                        <span>${esc(row.text)}: <b>${row.count}</b></span>
                                    </div>
                                `).join("") : `<div class="vf-muted">Ingen data</div>`}
                            </div>
                        </section>
                    </div>

                    <div class="vf-legend">
                        ${Object.entries(data.legend || {}).map(([code, text]) => `
                            <div class="vf-summary-item">
                                ${badge(code, text)}
                                <span>${esc(text)}</span>
                            </div>
                        `).join("")}
                    </div>
                </main>
            </div>
        `;
    }

    function wire(container, data, state, refresh) {
        function rerender() {
            container.innerHTML = render(data, state);
            wire(container, data, state, refresh);
        }

        container.querySelectorAll("[data-vf-employee]").forEach(button => {
            button.addEventListener("click", () => {
                state.employee = button.getAttribute("data-vf-employee") || "";
                rerender();
            });
        });

        container.querySelector("#vfArea")?.addEventListener("change", event => {
            state.area = event.target.value;
            state.employee = "";
            rerender();
        });

        container.querySelector("#vfSearch")?.addEventListener("input", event => {
            state.search = event.target.value || "";
            rerender();
        });

        container.querySelector("#vfMonth")?.addEventListener("change", event => {
            state.month = Number(event.target.value);
            rerender();
        });

        container.querySelector("#vfYear")?.addEventListener("change", event => {
            state.year = Number(event.target.value);
            state.sheet = String(state.year);
            state.employee = "";
            state.area = "";
            refresh(false);
        });

        container.querySelector("#vfRefresh")?.addEventListener("click", () => {
            refresh(true);
        });
    }

    async function start(container, options) {
        const now = new Date();

        const state = {
            year: Number(options.year || qs("year") || now.getFullYear()),
            month: Number(options.month || qs("month") || now.getMonth() + 1),
            employee: String(options.employee || qs("employee") || ""),
            sheet: String(options.sheet || qs("sheet") || ""),
            area: String(options.area || qs("area") || ""),
            search: ""
        };

        async function refresh(force) {
            container.innerHTML = `<div class="vf-loading">Henter vagt- og ferieplan...</div>`;

            try {
                const data = await loadYear(state, force);
                container.innerHTML = render(data, state);
                wire(container, data, state, refresh);
            } catch (error) {
                container.innerHTML = `
                    <div class="vf-error">
                        <b>Kunne ikke hente vagt-/ferieplan.</b><br>
                        ${esc(error.message)}
                    </div>
                `;
            }
        }

        await refresh(false);
    }

    window.renderVagtFerie = function renderVagtFerie(containerOrSelector, options = {}) {
        const element = typeof containerOrSelector === "string"
            ? document.querySelector(containerOrSelector)
            : containerOrSelector;

        if (!element) {
            return;
        }

        start(element, options);
    };

    document.addEventListener("DOMContentLoaded", () => {
        const root = document.getElementById("vagtFerieRoot");

        if (root) {
            window.renderVagtFerie(root, window.VAGT_FERIE_OPTIONS || {});
        }
    });
})();
