// frontend/assets/vagtferie.js
// Selvstaendig Vagt/Ferie-side til /vagtferie.html.
// Understoetter Person/Afdeling visning og bruger API-svaret fra /api/vagtferieplan med employees[].
// Ikke minified.

(function () {
    const MONTHS = [
        "Januar", "Februar", "Marts", "April", "Maj", "Juni",
        "Juli", "August", "September", "Oktober", "November", "December"
    ];

    const DAYS = ["Soen", "Man", "Tir", "Ons", "Tor", "Fre", "Loer"];
    const WEEK_DAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Loer", "Soen"];

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

    function norm(value) {
        return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function dateToIso(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function todayIso() {
        return dateToIso(new Date());
    }

    function parseIso(iso) {
        return new Date(`${iso}T00:00:00`);
    }

    function addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    function mondayOf(date) {
        const result = new Date(date);
        const day = result.getDay() || 7;
        result.setDate(result.getDate() - day + 1);
        return result;
    }

    function weekNumber(date) {
        const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNumber = utcDate.getUTCDay() || 7;
        utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
        const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
        return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
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
        const date = parseIso(iso);
        return `${String(date.getDate()).padStart(2, "0")} ${MONTHS[date.getMonth()].slice(0, 3)}`;
    }

    function fmtShortDate(date) {
        return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    function dayName(iso) {
        return DAYS[parseIso(iso).getDay()];
    }

    function apiUrl(state, refresh) {
        const params = new URLSearchParams();
        params.set("year", state.year);

        if (state.sheet) {
            params.set("sheet", state.sheet);
        }

        if (refresh) {
            params.set("refresh", "1");
        }

        return `/api/vagtferieplan?${params.toString()}`;
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
        return Array.from(new Set((employees || []).map(employee => employee.area).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, "da"));
    }

    function groupSections(employees) {
        return Array.from(new Set((employees || []).map(employee => employee.section || employee.area).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, "da"));
    }

    function filterForList(data, state) {
        const query = norm(state.search);

        return (data.employees || [])
            .filter(employee => !state.section || (employee.section || employee.area) === state.section)
            .filter(employee => !state.area || employee.area === state.area)
            .filter(employee => {
                if (!query) return true;
                return `${employee.name} ${employee.area} ${employee.section || ""}`.toLowerCase().includes(query);
            });
    }

    function findEmployee(data, state) {
        const rows = filterForList(data, state);

        if (!rows.length) {
            return null;
        }

        if (!state.employee) {
            return rows[0];
        }

        const query = norm(state.employee);

        return rows.find(employee => norm(employee.name) === query)
            || rows.find(employee => norm(employee.name).includes(query))
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
            const date = parseIso(iso);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;

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
        const rows = filterForList(data, state);

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

    function renderViewToggle(state) {
        return `
            <div class="vf-view-toggle">
                <button id="vfPersonView" class="vf-toggle-btn ${state.view === "person" ? "active" : ""}" type="button">Person</button>
                <button id="vfDeptView" class="vf-toggle-btn ${state.view === "department" ? "active" : ""}" type="button">Afdeling</button>
            </div>
        `;
    }

    function renderPersonView(data, state, employee) {
        const current = getCurrent(employee, data);
        const upcoming = getUpcoming(employee, data);
        const summary = getSummary(employee, state.year, data.legend || {});
        const days = monthDays(employee, state.year, state.month);

        return `
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
        `;
    }

    function departmentRows(data, state, employee) {
        const area = state.area || employee?.area || "";
        const section = state.section || employee?.section || "";

        return (data.employees || []).filter(row => {
            if (area) return row.area === area;
            if (section) return (row.section || row.area) === section;
            return true;
        });
    }

    function renderDepartmentView(data, state, employee) {
        const rows = departmentRows(data, state, employee);
        const areaTitle = state.area || employee?.area || state.section || employee?.section || "Alle afdelinger";
        const weekStart = mondayOf(parseIso(state.weekStart || todayIso()));
        const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
        const weekNo = weekNumber(weekStart);

        if (!rows.length) {
            return `<div class="vf-error">Ingen medarbejdere fundet for den valgte afdeling.</div>`;
        }

        return `
            <section class="vf-dept-view">
                <div class="vf-dept-head">
                    <div>
                        <h3 class="vf-section-title">Afdelingsoversigt · uge ${weekNo}</h3>
                        <div class="vf-muted">${esc(areaTitle)} · ${rows.length} medarbejdere</div>
                    </div>

                    <div class="vf-week-controls">
                        <button class="btn" id="vfPrevWeek" type="button">Forrige uge</button>
                        <button class="btn" id="vfThisWeek" type="button">Denne uge</button>
                        <button class="btn" id="vfNextWeek" type="button">Naeste uge</button>
                    </div>
                </div>

                <div class="vf-table-wrap">
                    <table class="vf-table">
                        <thead>
                            <tr>
                                <th>Medarbejder</th>
                                ${days.map(date => `
                                    <th class="${(date.getDay() === 0 || date.getDay() === 6) ? "vf-weekend-col" : ""}">
                                        ${WEEK_DAYS[(date.getDay() + 6) % 7]}<br>
                                        <span>${fmtShortDate(date)}</span>
                                    </th>
                                `).join("")}
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => {
                                const byDate = new Map((row.days || []).map(day => [day.date, day]));
                                return `
                                    <tr>
                                        <td>
                                            <button class="vf-link-btn" type="button" data-vf-employee="${esc(row.name)}">${esc(row.name)}</button>
                                            <div class="vf-muted">${esc(row.area || "")}</div>
                                        </td>
                                        ${days.map(date => {
                                            const item = byDate.get(dateToIso(date));
                                            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                                            return `<td class="${isWeekend ? "vf-weekend" : ""}">${item ? badge(item.code, item.text) : ""}</td>`;
                                        }).join("")}
                                    </tr>
                                `;
                            }).join("")}
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }

    function render(data, state) {
        const employee = findEmployee(data, state);

        if (!employee) {
            return `<div class="vf-error">Ingen medarbejdere fundet i arket.</div>`;
        }

        if (!state.employee) {
            state.employee = employee.name;
        }

        const sections = groupSections(data.employees);
        const areas = groupAreas(data.employees);
        const cacheText = data.cache?.hit ? "server-cache" : "ny laesning";

        return `
            <div class="vf-shell">
                <aside class="vf-side">
                    ${renderViewToggle(state)}

                    <div class="vf-toolbar">
                        <select id="vfSection">
                            <option value="">Alle afdelinger</option>
                            ${sections.map(section => `<option value="${esc(section)}" ${state.section === section ? "selected" : ""}>${esc(section)}</option>`).join("")}
                        </select>

                        <select id="vfArea">
                            <option value="">Alle omraader</option>
                            ${areas.map(area => `<option value="${esc(area)}" ${state.area === area ? "selected" : ""}>${esc(area)}</option>`).join("")}
                        </select>

                        <input id="vfSearch" type="search" placeholder="Soeg medarbejder" value="${esc(state.search)}">
                    </div>

                    <div class="vf-muted" style="margin-bottom:8px;">
                        ${(data.employees || []).length} medarbejdere indlaest · ${esc(cacheText)}
                    </div>

                    <div class="vf-employee-list" id="vfEmployees">
                        ${renderEmployeeButtons(data, state, employee.name)}
                    </div>
                </aside>

                <main class="vf-main">
                    <div class="vf-head">
                        <div>
                            <h2 class="vf-title">${state.view === "department" ? "Afdelingsoversigt" : esc(employee.name)}</h2>
                            <div class="vf-muted">${state.view === "department" ? "Ugevis visning for valgt afdeling/omraade" : `${esc(employee.area)}${employee.section && employee.section !== employee.area ? ` · ${esc(employee.section)}` : ""}`} · Ark: ${esc(data.source?.sheetName || state.year)} · ${esc(data.source?.fileName || "Excel")}</div>
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

                    ${state.view === "department" ? renderDepartmentView(data, state, employee) : renderPersonView(data, state, employee)}

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

        container.querySelector("#vfPersonView")?.addEventListener("click", () => {
            state.view = "person";
            rerender();
        });

        container.querySelector("#vfDeptView")?.addEventListener("click", () => {
            state.view = "department";
            rerender();
        });

        container.querySelectorAll("[data-vf-employee]").forEach(button => {
            button.addEventListener("click", () => {
                state.employee = button.getAttribute("data-vf-employee") || "";
                state.view = "person";
                rerender();
            });
        });

        container.querySelector("#vfSection")?.addEventListener("change", event => {
            state.section = event.target.value;
            state.employee = "";
            state.view = state.section ? "department" : state.view;
            rerender();
        });

        container.querySelector("#vfArea")?.addEventListener("change", event => {
            state.area = event.target.value;
            state.employee = "";
            state.view = state.area ? "department" : state.view;
            rerender();
        });

        container.querySelector("#vfSearch")?.addEventListener("input", event => {
            state.search = event.target.value || "";
            rerender();
        });

        container.querySelector("#vfMonth")?.addEventListener("change", event => {
            state.month = Number(event.target.value);
            state.weekStart = dateToIso(mondayOf(new Date(state.year, state.month - 1, 1)));
            rerender();
        });

        container.querySelector("#vfYear")?.addEventListener("change", event => {
            state.year = Number(event.target.value);
            state.sheet = String(state.year);
            state.employee = "";
            state.section = "";
            state.area = "";
            state.weekStart = dateToIso(mondayOf(new Date(state.year, state.month - 1, 1)));
            refresh(false);
        });

        container.querySelector("#vfRefresh")?.addEventListener("click", () => {
            refresh(true);
        });

        container.querySelector("#vfPrevWeek")?.addEventListener("click", () => {
            state.weekStart = dateToIso(addDays(parseIso(state.weekStart), -7));
            rerender();
        });

        container.querySelector("#vfThisWeek")?.addEventListener("click", () => {
            state.weekStart = dateToIso(mondayOf(new Date()));
            state.month = parseIso(state.weekStart).getMonth() + 1;
            rerender();
        });

        container.querySelector("#vfNextWeek")?.addEventListener("click", () => {
            state.weekStart = dateToIso(addDays(parseIso(state.weekStart), 7));
            rerender();
        });
    }

    async function start(container, options) {
        const now = new Date();
        const initialYear = Number(options.year || qs("year") || now.getFullYear());
        const initialMonth = Number(options.month || qs("month") || now.getMonth() + 1);

        const state = {
            year: initialYear,
            month: initialMonth,
            employee: String(options.employee || qs("employee") || ""),
            sheet: String(options.sheet || qs("sheet") || ""),
            section: String(options.section || qs("section") || ""),
            area: String(options.area || qs("area") || ""),
            search: "",
            view: String(options.view || qs("view") || "person"),
            weekStart: dateToIso(mondayOf(new Date(initialYear, initialMonth - 1, now.getDate())))
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
