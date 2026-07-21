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
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body
  };
}

function clean(v) { return String(v ?? "").replace(/\s+/g, " ").trim(); }
function norm(v) { return clean(v).toLowerCase(); }
function codeDisplay(v) { const c = clean(v); return LEGEND[c] || c; }

function isoDateLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startDateForSheet(year) {
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  const isoWeek1Monday = new Date(year, 0, 4 - day + 1);
  return addDays(isoWeek1Monday, -7);
}

function graphShareId(url) {
  return "u!" + Buffer.from(url, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getGraphToken() {
  const tenant = process.env.DV_TENANT_ID;
  const clientId = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;
  const missing = [];
  if (!tenant) missing.push("DV_TENANT_ID");
  if (!clientId) missing.push("DV_CLIENT_ID");
  if (!clientSecret) missing.push("DV_CLIENT_SECRET");
  if (missing.length) throw new Error("Manglende miljøvariabler: " + missing.join(", "));

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default"
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

async function graphGet(token, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) {
    const e = new Error(data?.error?.message || text || `Graph error ${r.status}`);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

async function getWorkbookUsedRange(token, fileUrl, sheetName) {
  const shareId = graphShareId(fileUrl);
  const item = await graphGet(token, `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem?$select=id,name,webUrl,parentReference`);
  const driveId = item?.parentReference?.driveId;
  const itemId = item?.id;
  if (!driveId || !itemId) throw new Error("Kunne ikke finde driveId/itemId for regnearket via vagtferieplanurl");

  const sheets = await graphGet(token, `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets?$select=id,name,position,visibility`);
  const sheet = (sheets.value || []).find(x => clean(x.name) === clean(sheetName));
  if (!sheet) throw new Error(`Ark ikke fundet: ${sheetName}. Fundne ark: ${(sheets.value || []).map(x => x.name).join(", ")}`);

  const range = await graphGet(token, `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${sheet.id}/usedRange(valuesOnly=true)`);
  return { fileName: item.name, fileWebUrl: item.webUrl, sheetName: sheet.name, values: range.values || [] };
}

function isHeader(row) {
  const c0 = norm(row?.[0]);
  const c1 = norm(row?.[1]);
  return (c0 === "navn" && c1 === "område") || (c1 === "område" && (c0 === "" || c0 === "omas" || c0.endsWith("navn")));
}

function findHeaderRows(values) {
  const out = [];
  for (let r = 0; r < values.length; r++) if (isHeader(values[r] || [])) out.push(r);
  return out;
}

function isLegendOrTitle(name, area) {
  const n = norm(name);
  const a = norm(area);
  if (!name && !area) return true;
  if (n === "navn" || a === "område") return true;
  if (/^\d{4}$/.test(n)) return true;
  return new Set([
    "ferieplan og vagtplan", "helligdag", "låst til løn", "vagt 16-07", "vagt wekeend",
    "vagt weekend", "telefon", "telefon 07-16", "ferie", "feriefridag", "afspadsering",
    "barsel", "orlov", "syg", "syg barn", "kursus", "optælling", "kaffemøde", "service"
  ]).has(n);
}

function buildDateCols(values, headerRow, year) {
  let maxCols = 0;
  for (let r = headerRow; r < Math.min(values.length, headerRow + 160); r++) maxCols = Math.max(maxCols, (values[r] || []).length);
  const start = startDateForSheet(year);
  const cols = [];
  for (let c = 2; c < maxCols; c++) {
    const d = addDays(start, c - 2);
    cols.push({ col: c, date: isoDateLocal(d), year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return cols;
}

function isDepartmentRow(row, dateCols) {
  const name = clean(row?.[0]);
  const area = clean(row?.[1]);
  if (!name || area || isLegendOrTitle(name, area)) return false;
  return !dateCols.some(d => clean(row?.[d.col]));
}

function isEmployeeRow(row) {
  const name = clean(row?.[0]);
  const area = clean(row?.[1]);
  if (!name || !area || isLegendOrTitle(name, area)) return false;
  if (/^\d+$/.test(name) && /^\d+$/.test(area)) return false;
  return true;
}

function mergeEmployee(map, employee) {
  const key = `${norm(employee.name)}|${norm(employee.area)}|${norm(employee.section)}`;
  if (!map.has(key)) map.set(key, { name: employee.name, area: employee.area, section: employee.section, sourceRows: [], days: [] });
  const e = map.get(key);
  if (employee.sourceRow && !e.sourceRows.includes(employee.sourceRow)) e.sourceRows.push(employee.sourceRow);
  const seen = new Set(e.days.map(d => `${d.date}|${d.code}`));
  for (const d of employee.days) {
    const k = `${d.date}|${d.code}`;
    if (!seen.has(k)) { e.days.push(d); seen.add(k); }
  }
  e.days.sort((a, b) => a.date.localeCompare(b.date));
}

function parseBlock(values, year, headerRow, nextHeaderRow) {
  const dateCols = buildDateCols(values, headerRow, year);
  const employees = [];
  let section = "";
  for (let r = headerRow + 2; r < nextHeaderRow; r++) {
    const row = values[r] || [];
    const name = clean(row[0]);
    const area = clean(row[1]);
    if (!name && !area) continue;
    if (isDepartmentRow(row, dateCols)) { section = name; continue; }
    if (!isEmployeeRow(row)) continue;

    const days = [];
    for (const d of dateCols) {
      const code = clean(row[d.col]);
      if (!code) continue;
      days.push({ date: d.date, code, text: codeDisplay(code), year: d.year, month: d.month, row: r + 1, col: d.col + 1 });
    }
    employees.push({ name, area, section: section || area, sourceRow: r + 1, days });
  }
  return employees;
}

function parseEmployees(values, year) {
  const headers = findHeaderRows(values);
  if (!headers.length) throw new Error("Kunne ikke finde nogen header-række med 'Navn' og 'Område'");
  const map = new Map();
  const parserInfo = { headerRows: headers.map(x => x + 1), blocks: [] };
  for (let i = 0; i < headers.length; i++) {
    const headerRow = headers[i];
    const nextHeaderRow = headers[i + 1] ?? values.length;
    const rows = parseBlock(values, year, headerRow, nextHeaderRow);
    parserInfo.blocks.push({ headerRow: headerRow + 1, nextHeaderRow: nextHeaderRow === values.length ? null : nextHeaderRow + 1, employeesFound: rows.length });
    rows.forEach(e => mergeEmployee(map, e));
  }
  const employees = Array.from(map.values()).sort((a, b) => {
    const s = String(a.section || "").localeCompare(String(b.section || ""), "da");
    if (s) return s;
    const ar = String(a.area || "").localeCompare(String(b.area || ""), "da");
    if (ar) return ar;
    return String(a.name || "").localeCompare(String(b.name || ""), "da");
  });
  return { employees, parserInfo };
}

async function getYearPayload(context, fileUrl, sheetName, year, refresh) {
  const key = `${fileUrl}|${sheetName}|${year}`;
  const now = Date.now();
  const cached = globalThis.__vagtferieCache.get(key);
  if (!refresh && cached && now - cached.cachedAt < CACHE_TTL_MS) return { ...cached.payload, cache: { hit: true, cachedAt: cached.cachedAt, ttlMs: CACHE_TTL_MS } };

  const token = await getGraphToken();
  const wb = await getWorkbookUsedRange(token, fileUrl, sheetName);
  const parsed = parseEmployees(wb.values, year);
  const payload = {
    source: { fileName: wb.fileName, fileWebUrl: wb.fileWebUrl, sheetName: wb.sheetName },
    year,
    today: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    employees: parsed.employees,
    legend: LEGEND,
    parserInfo: parsed.parserInfo
  };
  globalThis.__vagtferieCache.set(key, { cachedAt: now, payload });
  context.log(`vagtferieplan cache refresh: ${sheetName}, employees=${payload.employees.length}`);
  return { ...payload, cache: { hit: false, cachedAt: now, ttlMs: CACHE_TTL_MS } };
}

module.exports = async function(context, req) {
  const year = Number(req.query.year || new Date().getFullYear());
  const sheetName = clean(req.query.sheet || String(year));
  const refresh = ["1", "true", "yes"].includes(String(req.query.refresh || "").toLowerCase());
  const debug = ["1", "true", "yes"].includes(String(req.query.debug || "").toLowerCase());
  const fileUrl = process.env.vagtferieplanurl || process.env.VAGTFERIEPLANURL || process.env.VAGT_FERIE_PLAN_URL;

  if (!fileUrl) return json(context, 500, { error: "missing_setting", message: "Mangler SWA app setting: vagtferieplanurl" });
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return json(context, 400, { error: "invalid_year", message: "Ugyldigt år" });

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
    if (debug) response.debug = { parserInfo: payload.parserInfo, totalEmployees: payload.employees.length, cache: payload.cache };
    return json(context, 200, response);
  } catch (e) {
    context.log("vagtferieplan ERROR:", e.message, e.data || "");
    return json(context, e.status || 500, { error: "vagtferieplan_failed", message: e.message, status: e.status || 500 });
  }
};
