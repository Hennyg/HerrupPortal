// api/vagtferieplan/index.js
// Læser vagt-/ferieplan fra Excel-fil i SharePoint via Microsoft Graph.
// SWA app setting: vagtferieplanurl = den SharePoint/Excel URL du kopierede mens regnearket var åbent.
// Genbruger eksisterende app credentials: DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET.

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

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body
  };
}

function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function norm(v) {
  return clean(v).toLowerCase();
}

function excelDateToIso(serial) {
  // Excel serial date, 25569 = 1970-01-01. Ikke kritisk her, men nyttig hvis dato-rækken er ægte datoværdier.
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isoDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startDateForSheet(year) {
  // Arket starter med uge 52 før årsskiftet.
  // ISO uge 1 er ugen med 4. januar. Start = mandag i ISO uge 1 minus 7 dage.
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  const isoWeek1Monday = new Date(year, 0, 4 - day + 1);
  const start = new Date(isoWeek1Monday);
  start.setDate(start.getDate() - 7);
  return start;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function graphShareId(url) {
  const b64 = Buffer.from(url, "utf8").toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `u!${b64}`;
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
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.error?.message || text || `Graph error ${r.status}`;
    const e = new Error(msg);
    e.status = r.status;
    e.data = data;
    throw e;
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
  if (!driveId || !itemId) throw new Error("Kunne ikke finde driveId/itemId for regnearket via vagtferieplanurl");

  const sheets = await graphGet(
    token,
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets?$select=id,name,position,visibility`
  );

  const sheet = (sheets.value || []).find(x => clean(x.name) === clean(sheetName));
  if (!sheet) {
    throw new Error(`Ark ikke fundet: ${sheetName}. Fundne ark: ${(sheets.value || []).map(x => x.name).join(", ")}`);
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

function findHeaderRow(values) {
  // Finder den første rigtige datatabel-header: Navn + Område.
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    const c0 = norm(row[0]);
    const c1 = norm(row[1]);
    if ((c0 === "navn" || c0.endsWith("navn")) && c1 === "område") return r;
  }

  // Fallback til den første række hvor kolonne 2 ligner Område.
  for (let r = 0; r < values.length; r++) {
    if (norm((values[r] || [])[1]) === "område") return r;
  }

  throw new Error("Kunne ikke finde header-rækken med 'Navn' og 'Område'");
}

function buildDateColumns(values, headerRow, year) {
  const firstDate = startDateForSheet(year);
  const maxCols = Math.max(...values.map(r => (r || []).length), 0);
  const dateCols = [];

  for (let c = 2; c < maxCols; c++) {
    const d = addDays(firstDate, c - 2);
    dateCols.push({ col: c, date: isoDateLocal(d), year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  return dateCols;
}

function codeDisplay(raw) {
  const c = clean(raw);
  if (!c) return "";
  return LEGEND[c] || c;
}

function parseEmployees(values, year) {
  const headerRow = findHeaderRow(values);
  const dataStart = headerRow + 2;
  const dateCols = buildDateColumns(values, headerRow, year);
  const employees = [];
  let currentSection = "";

  for (let r = dataStart; r < values.length; r++) {
    const row = values[r] || [];
    const name = clean(row[0]);
    const area = clean(row[1]);

    if (!name && !area) continue;

    // Afdelingsoverskrifter står typisk kun i første kolonne.
    if (name && !area) {
      const hasCodes = dateCols.some(d => clean(row[d.col]));
      if (!hasCodes && name.length <= 40) currentSection = name;
      continue;
    }

    if (!name || !area) continue;
    if (norm(name) === "navn" || norm(area) === "område") continue;
    if (name.toLowerCase().includes("ferieplan") || name.toLowerCase().includes("helligdag")) continue;

    const days = [];
    for (const d of dateCols) {
      const code = clean(row[d.col]);
      if (!code) continue;
      days.push({
        date: d.date,
        code,
        text: codeDisplay(code),
        year: d.year,
        month: d.month
      });
    }

    employees.push({
      name,
      area,
      section: currentSection || area,
      year,
      days
    });
  }

  return employees;
}

function summarize(days, year) {
  const counts = {};
  for (const d of days) {
    if (d.year !== year) continue;
    counts[d.code] = (counts[d.code] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0], "da"))
    .map(([code, count]) => ({ code, text: codeDisplay(code), count }));
}

function pickCurrent(days, todayIso) {
  return days.find(d => d.date === todayIso) || null;
}

function pickUpcoming(days, todayIso, limit) {
  return days
    .filter(d => d.date >= todayIso)
    .slice(0, limit);
}

module.exports = async function (context, req) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const year = Number(req.query.year || new Date().getFullYear());
  const employeeQuery = clean(req.query.employee || "");
  const month = Number(req.query.month || 0);
  const limit = Math.min(Number(req.query.limit || 30), 120);
  const sheetName = clean(req.query.sheet || String(year));
  const fileUrl = process.env.vagtferieplanurl || process.env.VAGTFERIEPLANURL || process.env.VAGT_FERIE_PLAN_URL;

  if (!fileUrl) {
    return json(context, 500, {
      error: "missing_setting",
      message: "Mangler SWA app setting: vagtferieplanurl"
    });
  }

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return json(context, 400, { error: "invalid_year", message: "Ugyldigt år" });
  }

  try {
    const token = await getGraphToken();
    const wb = await getWorkbookUsedRange(token, fileUrl, sheetName);
    const parsed = parseEmployees(wb.values, year);

    const employees = parsed.map(e => ({ name: e.name, area: e.area, section: e.section }));
    let selected = null;

    if (employeeQuery) {
      selected = parsed.find(e => norm(e.name) === norm(employeeQuery))
        || parsed.find(e => norm(e.name).includes(norm(employeeQuery)));
    }

    if (!selected && parsed.length) selected = parsed[0];

    if (!selected) {
      return json(context, 404, {
        error: "no_employees",
        message: "Der blev ikke fundet medarbejderrækker i arket",
        source: { fileName: wb.fileName, sheetName: wb.sheetName }
      });
    }

    let days = selected.days.filter(d => d.year === year);
    if (month >= 1 && month <= 12) days = days.filter(d => d.month === month);

    return json(context, 200, {
      source: {
        fileName: wb.fileName,
        fileWebUrl: wb.fileWebUrl,
        sheetName: wb.sheetName
      },
      year,
      today: todayIso,
      employees,
      selectedEmployee: {
        name: selected.name,
        area: selected.area,
        section: selected.section,
        current: pickCurrent(selected.days, todayIso),
        upcoming: pickUpcoming(selected.days, todayIso, limit),
        summary: summarize(selected.days, year),
        days
      },
      legend: LEGEND
    });
  } catch (e) {
    context.log("vagtferieplan ERROR:", e.message, e.data || "");
    return json(context, e.status || 500, {
      error: "vagtferieplan_failed",
      message: e.message,
      status: e.status || 500
    });
  }
};
