// assets/herrup-vagtferie.js
// Rettet version: Dagens status opdateres i modal-headeren når ny person åbnes.
// Statuskortet vises ikke længere inde i selve Vagt/Ferie-fanens indhold.
// Ikke minified.

(function () {
    const CURRENT_YEAR = new Date().getFullYear();

    const MONTHS = [
        "Januar", "Februar", "Marts", "April", "Maj", "Juni",
        "Juli", "August", "September", "Oktober", "November", "December"
    ];

    const DAYS = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];
    const WEEK_DAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

    const progress = {
        azure: 0,
        vagt: 0,
        images: 0,
        azureDone: false,
        vagtDone: false,
        imagesDone: false,
        azureStarted: false,
        vagtStarted: false,
        imagesStarted: false
    };

    let panelState = {
        view: "person",
        month: new Date().getMonth() + 1,
        year: CURRENT_YEAR,
        weekStart: null
    };

    let lastHeaderStatusName = "";

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, match => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#39;"
        }[match]));
    }

    function dateToIso(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

    function todayIso() {
        return dateToIso(new Date());
    }

    function weekNumber(date) {
        const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNumber = utcDate.getUTCDay() || 7;
        utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
        const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
        return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
    }

    function percent(value) {
        return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
    }

    function badge(code, title) {
        const cleanCode = String(code || "").trim().replace(/[^a-zA-Z0-9]/g, "");
        const cssClass = cleanCode ? `vf-code-${cleanCode}` : "vf-code-other";
        return `<span class="vf-badge ${cssClass}" title="${esc(title || code)}">${esc(code)}</span>`;
    }

    function formatShortDate(date) {
        return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    function formatDate(iso) {
        const date = parseIso(iso);
        return `${String(date.getDate()).padStart(2, "0")} ${MONTHS[date.getMonth()].slice(0, 3)}`;
    }

    function ensureProgressCard() {
        let card = document.getElementById("herrupLoadCard");

        if (card) {
            return card;
        }

        card = document.createElement("div");
        card.id = "herrupLoadCard";
        card.className = "herrup-load-card";
        card.innerHTML = `
            <div class="herrup-load-title">Indlæser Herrup...</div>

            <div class="herrup-load-row">
                <div>Azure data</div>
                <div class="herrup-load-bar"><div id="herrupAzureFill" class="herrup-load-fill"></div></div>
                <div id="herrupAzurePct">0%</div>
            </div>

            <div class="herrup-load-row">
                <div>Vagt & ferie</div>
                <div class="herrup-load-bar"><div id="herrupVagtFill" class="herrup-load-fill"></div></div>
                <div id="herrupVagtPct">0%</div>
            </div>

            <div class="herrup-load-row">
                <div>Billeder</div>
                <div class="herrup-load-bar"><div id="herrupImagesFill" class="herrup-load-fill"></div></div>
                <div id="herrupImagesPct">0%</div>
            </div>
        `;

        document.body.appendChild(card);
        return card;
    }

    function updateProgress() {
        const card = ensureProgressCard();
        const rows = [
            ["azure", "herrupAzureFill", "herrupAzurePct"],
            ["vagt", "herrupVagtFill", "herrupVagtPct"],
            ["images", "herrupImagesFill", "herrupImagesPct"]
        ];

        for (const [key, fillId, percentId] of rows) {
            const fill = document.getElementById(fillId);
            const percentElement = document.getElementById(percentId);

            if (fill) {
                fill.style.width = percent(progress[key]);
                fill.classList.toggle("done", progress[`${key}Done`]);
            }

            if (percentElement) {
                percentElement.textContent = percent(progress[key]);
            }
        }

        if (progress.azureDone && progress.vagtDone && progress.imagesDone) {
            card.classList.add("is-hidden");
        }
    }

    function startFakeProgress(key) {
        const startedKey = `${key}Started`;

        if (progress[startedKey]) {
            return;
        }

        progress[startedKey] = true;

        const timer = setInterval(() => {
            if (progress[`${key}Done`]) {
                clearInterval(timer);
                return;
            }

            progress[key] = Math.min(92, progress[key] + Math.max(1, (92 - progress[key]) * .08));
            updateProgress();
        }, 180);
    }

    function markDone(key) {
        progress[key] = 100;
        progress[`${key}Done`] = true;
        updateProgress();
    }

    function monitorFetch() {
        if (window.__herrupFetchMonitorInstalled) {
            return;
        }

        window.__herrupFetchMonitorInstalled = true;

        const originalFetch = window.fetch.bind(window);
        let azurePending = 0;

        window.fetch = async function monitoredFetch(input, init) {
            const url = typeof input === "string" ? input : input?.url || "";
            const urlText = String(url).toLowerCase();

            if (urlText.includes("/api/vagtferieplan")) {
                startFakeProgress("vagt");
            } else if (urlText.includes("/api/")) {
                azurePending++;
                startFakeProgress("azure");
            }

            try {
                return await originalFetch(input, init);
            } finally {
                if (urlText.includes("/api/vagtferieplan")) {
                    markDone("vagt");
                } else if (urlText.includes("/api/")) {
                    azurePending = Math.max(0, azurePending - 1);
                    if (azurePending === 0) {
                        markDone("azure");
                        waitForVisibleImages();
                    }
                }
            }
        };
    }

    function waitForVisibleImages() {
        startFakeProgress("images");
        const images = Array.from(document.images || []);

        if (!images.length) {
            markDone("images");
            return;
        }

        let finished = 0;

        function imageDone() {
            finished++;
            progress.images = Math.min(100, (finished / images.length) * 100);
            updateProgress();

            if (finished >= images.length) {
                markDone("images");
            }
        }

        for (const image of images) {
            if (image.complete) {
                imageDone();
            } else {
                image.addEventListener("load", imageDone, { once: true });
                image.addEventListener("error", imageDone, { once: true });
            }
        }
    }

    async function preloadVagtFerie() {
        if (window.__vagtFeriePromise) {
            return window.__vagtFeriePromise;
        }

        startFakeProgress("vagt");

        window.__vagtFeriePromise = fetch(`/api/vagtferieplan?year=${CURRENT_YEAR}`, { cache: "no-store" })
            .then(async response => {
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

                window.__vagtFerieData = data;
                markDone("vagt");
                return data;
            })
            .catch(error => {
                console.warn("Kunne ikke forudindlæse vagt/ferie:", error);
                markDone("vagt");
                throw error;
            });

        return window.__vagtFeriePromise;
    }

    function selectedName() {
        return (document.getElementById("mName")?.textContent || "").trim();
    }

    function selectedJobTitle() {
        return (document.getElementById("mTitle")?.textContent || "").trim();
    }

    function selectedBadgeDepartment() {
        const badgeElement = document.querySelector("#mBadges .modal-badge");
        return (badgeElement?.textContent || "").trim();
    }

    function findEmployee(data, name) {
        const query = (name || "").toLowerCase().trim();
        const employees = data.employees || [];

        return employees.find(employee => (employee.name || "").toLowerCase() === query)
            || employees.find(employee => (employee.name || "").toLowerCase().includes(query))
            || null;
    }

    function dayMap(employee) {
        return new Map((employee?.days || []).map(day => [day.date, day]));
    }

    function upcoming(employee) {
        const today = todayIso();
        return (employee?.days || []).filter(day => day.date >= today).slice(0, 14);
    }

    function summary(employee, year) {
        const counts = new Map();

        for (const day of employee?.days || []) {
            if (Number(day.year) === Number(year)) {
                counts.set(day.code, (counts.get(day.code) || 0) + 1);
            }
        }

        return Array.from(counts.entries())
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "da"))
            .map(([code, count]) => ({ code, count }));
    }

    function monthDays(employee, year, month) {
        return (employee?.days || []).filter(day => {
            return Number(day.year) === Number(year) && Number(day.month) === Number(month);
        });
    }

    function renderStatusCard(current) {
        return `
            <div class="herrup-vf-card herrup-vf-status herrup-vf-status-top">
                <div class="vf-label">Dagens status</div>
                <div class="vf-current">
                    ${current ? `${badge(current.code, current.text)} <span>${esc(current.text)}</span>` : `<span class="vf-muted">Ingen markering i dag</span>`}
                </div>
            </div>
        `;
    }

    function ensureHeaderStatusCard() {
        let statusCard = document.getElementById("mCurrentStatusCard");

        if (statusCard) {
            return statusCard;
        }

        const badges = document.getElementById("mBadges");
        const infoBlock = badges?.parentElement;
        const headerRow = infoBlock?.parentElement;

        if (!headerRow) {
            return null;
        }

        statusCard = document.createElement("div");
        statusCard.id = "mCurrentStatusCard";
        headerRow.appendChild(statusCard);

        return statusCard;
    }

    async function updateHeaderStatus() {
        const name = selectedName();
        const statusCard = ensureHeaderStatusCard();

        if (!statusCard) {
            return;
        }

        if (!name) {
            statusCard.innerHTML = "";
            lastHeaderStatusName = "";
            return;
        }

        if (name === lastHeaderStatusName && statusCard.innerHTML.trim()) {
            return;
        }

        lastHeaderStatusName = name;
        statusCard.innerHTML = `<div class="vf-loading">Henter dagens status...</div>`;

        try {
            const data = window.__vagtFerieData || await preloadVagtFerie();
            const employee = findEmployee(data, name);
            const current = (employee?.days || []).find(day => day.date === todayIso());

            statusCard.innerHTML = renderStatusCard(current);
        } catch (error) {
            console.warn("Kunne ikke opdatere dagens status:", error);
            statusCard.innerHTML = "";
        }
    }

    function watchSelectedPerson() {
        const nameElement = document.getElementById("mName");

        if (!nameElement || nameElement.__vagtFerieObserver) {
            return;
        }

        nameElement.__vagtFerieObserver = true;

        const observer = new MutationObserver(() => {
            lastHeaderStatusName = "";
            updateHeaderStatus();
        });

        observer.observe(nameElement, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    function renderMiniMonth(employee) {
        const days = monthDays(employee, panelState.year, panelState.month);
        const byDate = new Map(days.map(day => [day.date, day]));
        const first = new Date(panelState.year, panelState.month - 1, 1);
        const last = new Date(panelState.year, panelState.month, 0);
        const pad = (first.getDay() + 6) % 7;

        let html = `<div class="herrup-vf-month">`;

        html += WEEK_DAYS
            .map(dayName => `<div class="vf-muted" style="text-align:center;font-weight:800">${dayName}</div>`)
            .join("");

        for (let i = 0; i < pad; i++) {
            html += `<div class="herrup-vf-daycell"></div>`;
        }

        for (let day = 1; day <= last.getDate(); day++) {
            const iso = `${panelState.year}-${String(panelState.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const item = byDate.get(iso);
            const date = parseIso(iso);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;

            html += `
                <div class="herrup-vf-daycell ${isWeekend ? "weekend" : ""}">
                    <div class="herrup-vf-daynr">${day}</div>
                    ${item ? badge(item.code, item.text) : ""}
                </div>
            `;
        }

        html += `</div>`;
        return html;
    }

    function renderSummary(data, employee) {
        const summaryRows = summary(employee, panelState.year);

        return `
            <div class="herrup-vf-card herrup-vf-summary-under-calendar">
                <h3 class="herrup-vf-section-title">Opsummering ${panelState.year}</h3>
                <div class="vf-summary">
                    ${summaryRows.length ? summaryRows.map(row => `
                        <div class="vf-summary-item">
                            ${badge(row.code, row.code)}
                            <span>${esc((data.legend || {})[row.code] || row.code)}: <b>${row.count}</b></span>
                        </div>
                    `).join("") : `<div class="vf-muted">Ingen data</div>`}
                </div>
            </div>
        `;
    }

    function renderPerson(data, employee) {
        if (!employee) {
            return `<div class="herrup-vf-empty">Ingen vagt-/feriedata fundet for ${esc(selectedName())}.</div>`;
        }

        const upcomingDays = upcoming(employee);

        return `
            <div class="herrup-vf-title">${esc(employee.name)}</div>
            <div class="herrup-vf-sub">${esc(employee.area || selectedBadgeDepartment() || "")} · ${esc(selectedJobTitle())}</div>

            <div class="herrup-vf-grid2">
                <section class="herrup-vf-card">
                    <h3 class="herrup-vf-section-title">Kommende 14 markeringer</h3>
                    <div class="herrup-vf-upcoming">
                        ${upcomingDays.length ? upcomingDays.map(day => `
                            <div class="herrup-vf-row">
                                <div>
                                    <div class="herrup-vf-date">${formatDate(day.date)}</div>
                                    <div class="herrup-vf-day">${DAYS[parseIso(day.date).getDay()]}</div>
                                </div>
                                <div>${esc(day.text)}</div>
                                <div>${badge(day.code, day.text)}</div>
                            </div>
                        `).join("") : `<div class="vf-muted">Ingen kommende markeringer</div>`}
                    </div>
                </section>

                <section class="herrup-vf-card">
                    <h3 class="herrup-vf-section-title">${MONTHS[panelState.month - 1]} ${panelState.year}</h3>
                    ${renderMiniMonth(employee)}
                    ${renderSummary(data, employee)}
                </section>
            </div>
        `;
    }

    function renderDepartment(data, employee) {
        if (!employee) {
            return `<div class="herrup-vf-empty">Ingen afdeling fundet.</div>`;
        }

        const area = employee.area || selectedBadgeDepartment();
        const rows = (data.employees || []).filter(row => (row.area || "") === area);
        const start = mondayOf(parseIso(panelState.weekStart || todayIso()));
        const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
        const weekNo = weekNumber(start);

        return `
            <div class="herrup-vf-title">${esc(employee.name)}</div>
            <div class="herrup-vf-sub">${esc(employee.area || selectedBadgeDepartment() || "")} · ${esc(selectedJobTitle())}</div>

            <div class="herrup-vf-dept-head">
                <div>
                    <div class="herrup-vf-title">${esc(area || "Afdeling")}</div>
                    <div class="herrup-vf-sub">Afdelingsoversigt · uge ${weekNo} · ${rows.length} medarbejdere</div>
                </div>

                <div class="herrup-vf-week-controls">
                    <button id="herrupVfPrev">Forrige uge</button>
                    <button id="herrupVfThis">Denne uge</button>
                    <button id="herrupVfNext">Næste uge</button>
                </div>
            </div>

            <div class="herrup-vf-table-wrap">
                <table class="herrup-vf-table">
                    <thead>
                        <tr>
                            <th>Medarbejder</th>
                            ${days.map(date => `
                                <th class="${(date.getDay() === 0 || date.getDay() === 6) ? "herrup-vf-weekend-col" : ""}">
                                    ${WEEK_DAYS[(date.getDay() + 6) % 7]}<br>
                                    <span>${formatShortDate(date)}</span>
                                </th>
                            `).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(row => {
                            const byDate = dayMap(row);
                            return `
                                <tr>
                                    <td>
                                        <b>${esc(row.name)}</b>
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

            ${renderSummary(data, employee)}
        `;
    }

    async function renderPanel() {
        const panel = document.getElementById("panelVagtFerie");

        if (!panel) {
            return;
        }

        panel.innerHTML = `<div class="vf-loading">Henter vagt og ferie...</div>`;

        let data = window.__vagtFerieData;

        try {
            if (!data) {
                data = await preloadVagtFerie();
            }

            const employee = findEmployee(data, selectedName());

            if (!panelState.weekStart) {
                panelState.weekStart = dateToIso(mondayOf(new Date()));
            }

            updateHeaderStatus();

            panel.innerHTML = `
                <div class="herrup-vf-toolbar">
                    <div class="herrup-vf-toggle">
                        <button id="herrupVfPerson" class="${panelState.view === "person" ? "active" : ""}">Person</button>
                        <button id="herrupVfDept" class="${panelState.view === "department" ? "active" : ""}">Afdeling</button>
                    </div>

                    <div class="herrup-vf-controls">
                        <select id="herrupVfMonth">
                            ${MONTHS.map((month, index) => `<option value="${index + 1}" ${(index + 1) === panelState.month ? "selected" : ""}>${month}</option>`).join("")}
                        </select>

                        <select id="herrupVfYear">
                            ${[panelState.year - 1, panelState.year, panelState.year + 1].map(year => `<option value="${year}" ${year === panelState.year ? "selected" : ""}>${year}</option>`).join("")}
                        </select>

                        <button id="herrupVfRefresh">Opdater data</button>
                    </div>
                </div>

                <div id="herrupVfContent">
                    ${panelState.view === "department" ? renderDepartment(data, employee) : renderPerson(data, employee)}
                </div>
            `;

            wirePanel();
        } catch (error) {
            panel.innerHTML = `<div class="vf-error"><b>Kunne ikke hente vagt-/ferieplan.</b><br>${String(error.message || error)}</div>`;
        }
    }

    function wirePanel() {
        document.getElementById("herrupVfPerson")?.addEventListener("click", () => {
            panelState.view = "person";
            renderPanel();
        });

        document.getElementById("herrupVfDept")?.addEventListener("click", () => {
            panelState.view = "department";
            renderPanel();
        });

        document.getElementById("herrupVfMonth")?.addEventListener("change", event => {
            panelState.month = Number(event.target.value);
            panelState.weekStart = dateToIso(mondayOf(new Date(panelState.year, panelState.month - 1, 1)));
            renderPanel();
        });

        document.getElementById("herrupVfYear")?.addEventListener("change", event => {
            panelState.year = Number(event.target.value);
            window.__vagtFerieData = null;
            window.__vagtFeriePromise = null;
            lastHeaderStatusName = "";
            renderPanel();
        });

        document.getElementById("herrupVfRefresh")?.addEventListener("click", () => {
            window.__vagtFerieData = null;
            window.__vagtFeriePromise = null;
            lastHeaderStatusName = "";
            renderPanel();
        });

        document.getElementById("herrupVfPrev")?.addEventListener("click", () => {
            panelState.weekStart = dateToIso(addDays(parseIso(panelState.weekStart), -7));
            renderPanel();
        });

        document.getElementById("herrupVfThis")?.addEventListener("click", () => {
            panelState.weekStart = dateToIso(mondayOf(new Date()));
            panelState.month = parseIso(panelState.weekStart).getMonth() + 1;
            renderPanel();
        });

        document.getElementById("herrupVfNext")?.addEventListener("click", () => {
            panelState.weekStart = dateToIso(addDays(parseIso(panelState.weekStart), 7));
            renderPanel();
        });
    }

    function addModalTab() {
        const tabs = document.querySelector(".modal-tabs");
        const body = document.querySelector(".modal-body");

        if (!tabs || !body || document.getElementById("mtVagtFerie")) {
            return;
        }

        const button = document.createElement("button");
        button.className = "herrup-vf-tab-btn";
        button.id = "mtVagtFerie";
        button.type = "button";
        button.textContent = "Vagt/Ferie";
        tabs.appendChild(button);

        const panel = document.createElement("div");
        panel.className = "modal-tab-panel";
        panel.id = "panelVagtFerie";
        body.appendChild(panel);

        const originalSwitchModalTab = window.switchModalTab;

        if (typeof originalSwitchModalTab === "function" && !window.__vfSwitchWrapped) {
            window.__vfSwitchWrapped = true;
            window.switchModalTab = function switchModalTabWrapped(tab) {
                panel.classList.remove("active");
                button.classList.remove("active");
                originalSwitchModalTab(tab);
            };
        }

        button.addEventListener("click", () => {
            document.querySelectorAll(".modal-tab, .herrup-vf-tab-btn").forEach(tab => tab.classList.remove("active"));
            document.querySelectorAll(".modal-tab-panel").forEach(tabPanel => tabPanel.classList.remove("active"));

            button.classList.add("active");
            panel.classList.add("active");
            panelState.view = "person";
            renderPanel();
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        ensureProgressCard();
        monitorFetch();
        startFakeProgress("azure");
        startFakeProgress("images");
        preloadVagtFerie().catch(() => {});
        addModalTab();
        watchSelectedPerson();

        new MutationObserver(() => {
            addModalTab();
            watchSelectedPerson();
        }).observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        window.addEventListener("load", () => {
            if (!progress.azureDone) {
                markDone("azure");
            }

            waitForVisibleImages();
        });
    });

    window.updateHeaderStatus = updateHeaderStatus;
})();
