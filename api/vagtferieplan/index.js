// api/vagtferieplan/index.js
// Læser vagt-/ferieplan fra Excel-fil i SharePoint via Microsoft Graph.
// SWA app setting: vagtferieplanurl = SharePoint/Excel URL til regnearket.
// Genbruger eksisterende app credentials: DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET.
//
// Vigtigt:
// Parseren finder ALLE datablokke i arket, dvs. alle steder hvor kolonne B er "Område".
// Det gør, at både øverste og nederste tabel i samme år-Ark bliver læst.

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
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body
  };
}

function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function norm(v) {
  return clean(v).toLowerCase();
}

function isoDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function startDateForSheet(year) {
  // Arket starter typisk med ugen før uge 1.
  // ISO uge 1 er ugen med 4. januar.
  // Start = mandag i ISO uge 1 minus 7 dage.
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  const isoWeek1Monday = new Date(year, 0, 4 - day + 1);
  const start = new Date(isoWeek1Monday);
  start.setDate(start.getDate() - 7);
  return start;
}

function graphShareId(url) {
  const b64 = Buffer.from(url, "utf8")
    .toString("base64")
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

  if (missing.length) {
    throw new Error("Manglende miljøvariabler: " + missing.join(", "));
  }

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default"
    })
  });

  const j = await r.json();

  if (!r.ok) {
    throw new Error(`token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  }

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

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

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

  if (!driveId || !itemId) {
    throw new Error("Kunne ikke finde driveId/itemId for regnearket via vagtferieplanurl");
  }

  const sheets = await graphGet(
    token,
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets?$select=id,name,position,visibility`
  );

  const sheet = (sheets.value || []).find(x => clean(x.name) === clean(sheetName));

  if (!sheet) {
    throw new Error(
      `Ark ikke fundet: ${sheetName}. Fundne ark: ${(sheets.value || []).map(x => x.name).join(", ")}`
    );
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

function codeDisplay(raw) {
  const c = clean(raw);
  if (!c) return "";
  return LEGEND[c] || c;
}

function isProbablyHeaderRow(row) {
  const c0 = norm(row?.[0]);
  const c1 = norm(row?.[1]);

  // Normal header
  if (c0 === "navn" && c1 === "område") return true;

  // I et tidligere udtræk så første header ud som "omas" i stedet for "Navn".
  if (c1 === "område" && (c0 === "" || c0 === "omas" || c0.endsWith("navn"))) return true;

  return false;
}

function findHeaderRows(values) {
  const rows = [];

  for (let r = 0; r < values.length; r++) {
    if (isProbablyHeaderRow(values[r] || [])) {
      rows.push(r);
    }
  }

  return rows;
}

function looksLikeLegendOrTitle(name, area) {
  const n = norm(name);
  const a = norm(area);

  if (!name && !area) return true;
  if (n === "navn" || a === "område") return true;
  if (n === "ferieplan og vagtplan") return true;
  if (n === "helligdag") return true;
  if (n === "låst til løn") return true;
  if (n === "vagt 16-07") return true;
  if (n === "vagt wekeend") return true;
  if (n === "vagt weekend") return true;
  if (n === "telefon") return true;
  if (n === "ferie") return true;
  if (n === "feriefridag") return true;
  if (n === "afspadsering") return true;
  if (n === "barsel") return true;
  if (n === "orlov") return true;
  if (n === "syg") return true;
  if (n === "syg barn") return true;
  if (n === "kursus") return true;
  if (n === "optælling") return true;
  if (n === "kaffemøde") return true;

  return false;
}

function isDepartmentRow(row, dateCols) {
  const name = clean(row?.[0]);
  const area = clean(row?.[1]);

  if (!name || area) return false;

  const hasCodes = dateCols.some(d => clean(row?.[d.col]));
  if (hasCodes) return false;

  if (looksLikeLegendOrTitle(name, area)) return false;

  return true;
}

function isEmployeeRow(row) {
  const name = clean(row?.[0]);
  const area = clean(row?.[1]);

  if (!name || !area) return false;
  if (looksLikeLegendOrTitle(name, area)) return false;

  // Undgå årstal, uge-numre og rene metadata-linjer
  if (/^\d{4}$/.test(name)) return false;
  if (/^\d+$/.test(name) && /^\d+$/.test(area)) return false;

  return true;
}

function buildDateColumns(values, headerRow, year) {
  const firstDate = startDateForSheet(year);

  // Brug max col indenfor området omkring headeren.
  // Det er mere stabilt end at kigge på hele usedRange, hvis der ligger støj længere nede.
  let maxCols = 0;
  const scanUntil = Math.min(values.length, headerRow + 120);

  for (let r = headerRow; r < scanUntil; r++) {
    maxCols = Math.max(maxCols, (values[r] || []).length);
  }

  const dateCols = [];

  for (let c = 2; c < maxCols; c++) {
    const d = addDays(firstDate, c - 2);

    dateCols.push({
      col: c,
      date: isoDateLocal(d),
      year: d.getFullYear(),
      month: d.getMonth() + 1
    });
  }

  return dateCols;
}

function addOrMergeEmployee(map, employee) {
  const key = `${norm(employee.name)}|${norm(employee.area)}|${norm(employee.section)}`;

  if (!map.has(key)) {
    map.set(key, {
      name: employee.name,
      area: employee.area,
      section: employee.section,
      year: employee.year,
      days: []
    });
  }

  const existing = map.get(key);
  const byDate = new Map(existing.days.map(d => [`${d.date}|${d.code}`, d]));

  for (const d of employee.days) {
    const dayKey = `${d.date}|${d.code}`;
    if (!byDate.has(dayKey)) {
      existing.days.push(d);
      byDate.set(dayKey, d);
    }
  }

  existing.days.sort((a, b) => a.date.localeCompare(b.date));
}

function parseBlock(values, year, headerRow, nextHeaderRow) {
  const dateCols = buildDateColumns(values, headerRow, year);
  const employees = [];
  let currentSection = "";

  // HeaderRow + 1 er typisk dato-rækken.
  // Data starter derfor ved headerRow + 2.
  const startRow = headerRow + 2;
  const endRow = nextHeaderRow ?? values.length;

  for (let r = startRow; r < endRow; r++) {
    const row = values[r] || [];
    const name = clean(row[0]);
    const area = clean(row[1]);

    if (!name && !area) continue;

    if (isDepartmentRow(row, dateCols)) {
      currentSection = name;
      continue;
    }

    if (!isEmployeeRow(row)) continue;

    const days = [];

    for (const d of dateCols) {
      const code = clean(row[d.col]);
      if (!code) continue;

      days.push({
        date: d.date,
        code,
        text: codeDisplay(code),
        year: d.year,
        month: d.month,
        row: r + 1,
        col: d.col + 1
      });
    }

    employees.push({
      name,
      area,
      section: currentSection || area,
      year,
      sourceRow: r + 1,
      days
    });
  }

  return employees;
}

function parseEmployees(values, year) {
  const headerRows = findHeaderRows(values);

  if (!headerRows.length) {
    throw new Error("Kunne ikke finde nogen header-række med 'Navn' og 'Område'");
  }

  const employeeMap = new Map();
  const parserInfo = {
    headerRows: headerRows.map(r => r + 1),
    blocks: []
  };

  for (let i = 0; i < headerRows.length; i++) {
    const headerRow = headerRows[i];
    const nextHeaderRow = headerRows[i + 1] ?? values.length;

    const blockEmployees = parseBlock(values, year, headerRow, nextHeaderRow);

    parserInfo.blocks.push({
      headerRow: headerRow + 1,
      nextHeaderRow: nextHeaderRow === values.length ? null : nextHeaderRow + 1,
      employeesFound: blockEmployees.length
    });

    for (const employee of blockEmployees) {
      addOrMergeEmployee(employeeMap, employee);
    }
  }

  const employees = Array.from(employeeMap.values())
    .sort((a, b) => {
      const areaCompare = a.area.localeCompare(b.area, "da");
      if (areaCompare !== 0) return areaCompare;
      return a.name.localeCompare(b.name, "da");
    });

  return {
    employees,
    parserInfo
  };
}

function summarize(days, year) {
  const counts = {};

  for (const d of days) {
    if (d.year !== year) continue;
    counts[d.code] = (counts[d.code] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0], "da"))
    .map(([code, count]) => ({
      code,
      text: codeDisplay(code),
      count
    }));
}

function pickCurrent(days, todayIso) {
  return days.find(d => d.date === todayIso) || null;
}

function pickUpcoming(days, todayIso, limit) {
  return days
    .filter(d => d.date >= todayIso)
    .slice(0, limit);
}

function findSelectedEmployee(parsed, employeeQuery) {
  if (!parsed.length) return null;

  if (!employeeQuery) return parsed[0];

  const q = norm(employeeQuery);

  return parsed.find(e => norm(e.name) === q)
    || parsed.find(e => norm(e.name).includes(q))
    || parsed.find(e => q.includes(norm(e.name)))
    || parsed[0];
}

module.exports = async function (context, req) {
  const todayIso = new Date().toISOString().slice(0, 10);

  const year = Number(req.query.year || new Date().getFullYear());
  const employeeQuery = clean(req.query.employee || "");
  const month = Number(req.query.month || 0);
  const limit = Math.min(Number(req.query.limit || 30), 120);
  const sheetName = clean(req.query.sheet || String(year));

  const debug = String(req.query.debug || "").toLowerCase() === "1"
    || String(req.query.debug || "").toLowerCase() === "true";

  const fileUrl =
    process.env.vagtferieplanurl
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
    const token = await getGraphToken();
    const wb = await getWorkbookUsedRange(token, fileUrl, sheetName);

    const parsedResult = parseEmployees(wb.values, year);
    const parsed = parsedResult.employees;

    const employees = parsed.map(e => ({
      name: e.name,
      area: e.area,
      section: e.section
    }));

    const selected = findSelectedEmployee(parsed, employeeQuery);

    if (!selected) {
      return json(context, 404, {
        error: "no_employees",
        message: "Der blev ikke fundet medarbejderrækker i arket",
        source: {
          fileName: wb.fileName,
          sheetName: wb.sheetName
        },
        parserInfo: parsedResult.parserInfo
      });
    }

    let days = selected.days.filter(d => d.year === year);

    if (month >= 1 && month <= 12) {
      days = days.filter(d => d.month === month);
    }

    const response = {
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
    };

    if (debug) {
      response.debug = {
        parserInfo: parsedResult.parserInfo,
        totalEmployees: employees.length,
        selectedSourceRows: selected.days
          .map(d => d.row)
          .filter(Boolean)
          .slice(0, 20)
      };
    }

    return json(context, 200, response);
  } catch (e) {
    context.log("vagtferieplan ERROR:", e.message, e.data || "");

    return json(context, e.status || 500, {
      error: "vagtferieplan_failed",
      message: e.message,
      status: e.status || 500
    });
  }
};
