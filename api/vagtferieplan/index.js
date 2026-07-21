// api/vagtferieplan/index.js
// Læser SharePoint Excel-arket via Microsoft Graph.
// Returnerer alle medarbejdere og alle markeringer for året.
// Bevidst formatteret og ikke minified.

const fetch = globalThis.fetch;

const LEGEND = {
    H: "Helligdag",
    L: "Låst til løn",
    N: "Vagt 16-07",
    W: "Weekendvagt",
    T: "Telefon",
    F: "Ferie",
    FF: "Feriefridag",
    A: "Afspadsering",
    B: "Barsel",
    O: "Orlov / Optælling",
    S: "Syg",
    SB: "Syg barn",
    K: "Kursus",
    M: "Møde",
    "1/2F": "Halv feriedag"
};

const CACHE_TTL_MS = 10 * 60 * 1000;
globalThis.__vagtferieCache = globalThis.__vagtferieCache || new Map();

function json(context, status, body) {
    context.res = {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        },
        body
    };
}

function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value) {
    return clean(value).toLowerCase();
}

function isoDateLocal(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function startDateForSheet(year) {
    const jan4 = new Date(year, 0, 4);
    const day = jan4.getDay() || 7;
    const isoWeek1Monday = new Date(year, 0, 4 - day + 1);
    return addDays(isoWeek1Monday, -7);
}

function graphShareId(url) {
    return "u!" + Buffer.from(url, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

async function getGraphToken() {
    const tenant = process.env.DV_TENANT_ID;
    const clientId = process.env.DV_CLIENT_ID;
    const clientSecret = process.env.DV_CLIENT_SECRET;

    const missing = [];
    if (!tenant) missing.push("DV_TENANT_ID");
    if (!clientId) missing.push("DV_CLIENT_ID");
    if (!clientSecret) missing.push("DV_CLIENT_SECRET");

    if (missing.length) {
        throw new Error("Manglende miljøvariabler: " + missing.join(", "));
    }

    const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            scope: "https://graph.microsoft.com/.default"
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`token_error ${response.status}: ${data.error_description || JSON.stringify(data)}`);
    }

    return data.access_token;
}

async function graphGet(token, url) {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json"
        }
    });

    const text = await response.text();
    let data = null;

    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { raw: text };
    }

    if (!response.ok) {
        const error = new Error(data?.error?.message || text || `Graph error ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

async function getWorkbookUsedRange(token, fileUrl, sheetName) {
    const shareId = graphShareId(fileUrl);

    const item = await graphGet(
        token,
        `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem?$select=id,name,webUrl,parentReference`
    );

    const driveId = item?.parentReference?.driveId;
    const itemId = item?.id;

    if (!driveId || !itemId) {
        throw new Error("Kunne ikke finde driveId/itemId for regnearket via vagtferieplanurl");
    }

    const sheets = await graphGet(
        token,
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets?$select=id,name,position,visibility`
    );

    const sheet = (sheets.value || []).find(item => clean(item.name) === clean(sheetName));

    if (!sheet) {
        throw new Error(`Ark ikke fundet: ${sheetName}. Fundne ark: ${(sheets.value || []).map(item => item.name).join(", ")}`);
    }

    const range = await graphGet(
        token,
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${sheet.id}/usedRange(valuesOnly=true)`
    );

    return {
        fileName: item.name,
        fileWebUrl: item.webUrl,
        sheetName: sheet.name,
        values: range.values || []
    };
}

function isHeader(row) {
    const first = norm(row?.[0]);
    const second = norm(row?.[1]);
    return (first === "navn" && second === "område") || (second === "område" && (first === "" || first === "omas" || first.endsWith("navn")));
}

function findHeaderRows(values) {
    const rows = [];

    for (let row = 0; row < values.length; row++) {
        if (isHeader(values[row] || [])) {
            rows.push(row);
        }
    }

    return rows;
}

function isLegendOrTitle(name, area) {
    const normalizedName = norm(name);
    const normalizedArea = norm(area);

    if (!name && !area) return true;
    if (normalizedName === "navn" || normalizedArea === "område") return true;
    if (/^\d{4}$/.test(normalizedName)) return true;

    return new Set([
        "ferieplan og vagtplan",
        "helligdag",
        "låst til løn",
        "vagt 16-07",
        "vagt wekeend",
        "vagt weekend",
        "telefon",
        "telefon 07-16",
        "ferie",
        "feriefridag",
        "afspadsering",
        "barsel",
        "orlov",
        "syg",
        "syg barn",
        "kursus",
        "optælling",
        "kaffemøde",
        "service"
    ]).has(normalizedName);
}

function buildDateColumns(values, headerRow, year) {
    let maxColumns = 0;

    for (let row = headerRow; row < Math.min(values.length, headerRow + 160); row++) {
        maxColumns = Math.max(maxColumns, (values[row] || []).length);
    }

    const start = startDateForSheet(year);
    const columns = [];

    for (let col = 2; col < maxColumns; col++) {
        const date = addDays(start, col - 2);
        columns.push({
            col,
            date: isoDateLocal(date),
            year: date.getFullYear(),
            month: date.getMonth() + 1
        });
    }

    return columns;
}

function isDepartmentRow(row, dateColumns) {
    const name = clean(row?.[0]);
    const area = clean(row?.[1]);

    if (!name || area || isLegendOrTitle(name, area)) return false;

    return !dateColumns.some(column => clean(row?.[column.col]));
}

function isEmployeeRow(row) {
    const name = clean(row?.[0]);
    const area = clean(row?.[1]);

    if (!name || !area || isLegendOrTitle(name, area)) return false;
    if (/^\d+$/.test(name) && /^\d+$/.test(area)) return false;

    return true;
}

function codeDisplay(value) {
    const code = clean(value);
    return LEGEND[code] || code;
}

function mergeEmployee(map, employee) {
    const key = `${norm(employee.name)}|${norm(employee.area)}|${norm(employee.section)}`;

    if (!map.has(key)) {
        map.set(key, {
            name: employee.name,
            area: employee.area,
            section: employee.section,
            sourceRows: [],
            days: []
        });
    }

    const existing = map.get(key);

    if (employee.sourceRow && !existing.sourceRows.includes(employee.sourceRow)) {
        existing.sourceRows.push(employee.sourceRow);
    }

    const seen = new Set(existing.days.map(day => `${day.date}|${day.code}`));

    for (const day of employee.days) {
        const dayKey = `${day.date}|${day.code}`;

        if (!seen.has(dayKey)) {
            existing.days.push(day);
            seen.add(dayKey);
        }
    }

    existing.days.sort((a, b) => a.date.localeCompare(b.date));
}

function parseBlock(values, year, headerRow, nextHeaderRow) {
    const dateColumns = buildDateColumns(values, headerRow, year);
    const employees = [];
    let section = "";

    for (let rowIndex = headerRow + 2; rowIndex < nextHeaderRow; rowIndex++) {
        const row = values[rowIndex] || [];
        const name = clean(row[0]);
        const area = clean(row[1]);

        if (!name && !area) continue;

        if (isDepartmentRow(row, dateColumns)) {
            section = name;
            continue;
        }

        if (!isEmployeeRow(row)) continue;

        const days = [];

        for (const column of dateColumns) {
            const code = clean(row[column.col]);
            if (!code) continue;

            days.push({
                date: column.date,
                code,
                text: codeDisplay(code),
                year: column.year,
                month: column.month,
                row: rowIndex + 1,
                col: column.col + 1
            });
        }

        employees.push({
            name,
            area,
            section: section || area,
            sourceRow: rowIndex + 1,
            days
        });
    }

    return employees;
}

function parseEmployees(values, year) {
    const headers = findHeaderRows(values);

    if (!headers.length) {
        throw new Error("Kunne ikke finde nogen header-række med 'Navn' og 'Område'");
    }

    const map = new Map();
    const parserInfo = {
        headerRows: headers.map(row => row + 1),
        blocks: []
    };

    for (let index = 0; index < headers.length; index++) {
        const headerRow = headers[index];
        const nextHeaderRow = headers[index + 1] ?? values.length;
        const employees = parseBlock(values, year, headerRow, nextHeaderRow);

        parserInfo.blocks.push({
            headerRow: headerRow + 1,
            nextHeaderRow: nextHeaderRow === values.length ? null : nextHeaderRow + 1,
            employeesFound: employees.length
        });

        for (const employee of employees) {
            mergeEmployee(map, employee);
        }
    }

    const employees = Array.from(map.values()).sort((a, b) => {
        const sectionCompare = String(a.section || "").localeCompare(String(b.section || ""), "da");
        if (sectionCompare) return sectionCompare;

        const areaCompare = String(a.area || "").localeCompare(String(b.area || ""), "da");
        if (areaCompare) return areaCompare;

        return String(a.name || "").localeCompare(String(b.name || ""), "da");
    });

    return { employees, parserInfo };
}

async function getYearPayload(context, fileUrl, sheetName, year, refresh) {
    const key = `${fileUrl}|${sheetName}|${year}`;
    const now = Date.now();
    const cached = globalThis.__vagtferieCache.get(key);

    if (!refresh && cached && now - cached.cachedAt < CACHE_TTL_MS) {
        return {
            ...cached.payload,
            cache: {
                hit: true,
                cachedAt: cached.cachedAt,
                ttlMs: CACHE_TTL_MS
            }
        };
    }

    const token = await getGraphToken();
    const workbook = await getWorkbookUsedRange(token, fileUrl, sheetName);
    const parsed = parseEmployees(workbook.values, year);

    const payload = {
        source: {
            fileName: workbook.fileName,
            fileWebUrl: workbook.fileWebUrl,
            sheetName: workbook.sheetName
        },
        year,
        today: new Date().toISOString().slice(0, 10),
        generatedAt: new Date().toISOString(),
        employees: parsed.employees,
        legend: LEGEND,
        parserInfo: parsed.parserInfo
    };

    globalThis.__vagtferieCache.set(key, {
        cachedAt: now,
        payload
    });

    context.log(`vagtferieplan cache refresh: ${sheetName}, employees=${payload.employees.length}`);

    return {
        ...payload,
        cache: {
            hit: false,
            cachedAt: now,
            ttlMs: CACHE_TTL_MS
        }
    };
}

module.exports = async function vagtferieplan(context, req) {
    const year = Number(req.query.year || new Date().getFullYear());
    const sheetName = clean(req.query.sheet || String(year));
    const refresh = ["1", "true", "yes"].includes(String(req.query.refresh || "").toLowerCase());
    const debug = ["1", "true", "yes"].includes(String(req.query.debug || "").toLowerCase());

    const fileUrl = process.env.vagtferieplanurl
        || process.env.VAGTFERIEPLANURL
        || process.env.VAGT_FERIE_PLAN_URL;

    if (!fileUrl) {
        return json(context, 500, {
            error: "missing_setting",
            message: "Mangler SWA app setting: vagtferieplanurl"
        });
    }

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return json(context, 400, {
            error: "invalid_year",
            message: "Ugyldigt år"
        });
    }

    try {
        const payload = await getYearPayload(context, fileUrl, sheetName, year, refresh);

        const response = {
            source: payload.source,
            year: payload.year,
            today: payload.today,
            employees: payload.employees,
            legend: payload.legend,
            cache: payload.cache
        };

        if (debug) {
            response.debug = {
                parserInfo: payload.parserInfo,
                totalEmployees: payload.employees.length,
                cache: payload.cache
            };
        }

        return json(context, 200, response);
    } catch (error) {
        context.log("vagtferieplan ERROR:", error.message, error.data || "");

        return json(context, error.status || 500, {
            error: "vagtferieplan_failed",
            message: error.message,
            status: error.status || 500
        });
    }
};
