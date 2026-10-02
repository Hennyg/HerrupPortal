// /api/portalstats/index.js
//
// Brugsstatistik for Herrup Portalen til statistik.html.
//
//   GET /api/portalstats?from=2026-09-01&to=2026-09-30
//
// Kræver rollen portal_admin eller portal_herrup_portal_admin. Det sikres
// både af route-reglen i staticwebapp.config.json og her i koden.
//
// Data: lch_accesslog (entity set cr175_lch_accesslogs), skrevet af /api/track.

const { dvFetch } = require("../_dv");

const ENTITY_SET = process.env.ACCESSLOG_ENTITY_SET || "cr175_lch_accesslogs";
const ADMIN_ROLES = ["portal_admin", "portal_herrup_portal_admin"];
const TZ = "Europe/Copenhagen";
const MAX_DAYS = 366;
const MAX_ROWS = 100000;

const BASE_COLS = ["cr175_lch_useremail", "cr175_lch_timestamputc", "cr175_lch_path", "cr175_lch_useragent"];
const EXTRA_COLS = ["cr175_lch_eventtype", "cr175_lch_targettitle", "cr175_lch_targeturl", "cr175_lch_targetcategory"];

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body };
}

function getRoles(req) {
  try {
    const cp = JSON.parse(Buffer.from(req.headers["x-ms-client-principal"] || "", "base64").toString("utf8"));
    return (cp?.userRoles || []).map(r => String(r).toLowerCase());
  } catch {
    return [];
  }
}

module.exports = async function (context, req) {
  try {
    if (!getRoles(req).some(r => ADMIN_ROLES.includes(r))) {
      return json(context, 403, { error: "Kun for portal_admin." });
    }

    const today = localDate(new Date());
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.from || "") ? req.query.from : addDays(today, -29);
    const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.to || "")   ? req.query.to   : today;
    if (to < from) return json(context, 400, { error: "'Til' ligger før 'Fra'." });
    if (daysBetween(from, to) > MAX_DAYS) return json(context, 400, { error: `Højst ${MAX_DAYS} dage ad gangen.` });

    // ---------- Hent rækker ----------
    const filter = `cr175_lch_timestamputc ge ${localMidnightUtc(from)} and cr175_lch_timestamputc lt ${localMidnightUtc(addDays(to, 1))}`;
    let rows, hasClickColumns = true;
    try {
      rows = await getRows([...BASE_COLS, ...EXTRA_COLS], filter);
    } catch (e) {
      if (e.status !== 400) throw e;
      hasClickColumns = false;                 // de valgfri kolonner findes ikke endnu
      rows = await getRows(BASE_COLS, filter);
    }

    // ---------- Beregn ----------
    const events = rows.map(r => {
      const ts = new Date(r.cr175_lch_timestamputc);
      const local = localParts(ts);
      return {
        user: String(r.cr175_lch_useremail || "").toLowerCase() || "(ukendt)",
        type: r.cr175_lch_eventtype || "PageView",
        path: normalizePath(r.cr175_lch_path),
        title: String(r.cr175_lch_targettitle || "").trim(),
        url: String(r.cr175_lch_targeturl || "").trim(),
        category: String(r.cr175_lch_targetcategory || "").trim(),
        device: device(r.cr175_lch_useragent),
        browser: browser(r.cr175_lch_useragent),
        date: local.date, hour: local.hour, weekday: local.weekday,
        ts: ts.toISOString()
      };
    });

    const views = events.filter(e => e.type === "PageView");
    const clicks = events.filter(e => e.type === "Click");

    // Pr. dag
    const byDay = {};
    for (let d = from; d <= to; d = addDays(d, 1)) byDay[d] = { date: d, pageviews: 0, clicks: 0, users: new Set() };
    for (const e of events) {
      const x = byDay[e.date]; if (!x) continue;
      if (e.type === "PageView") x.pageviews++; else x.clicks++;
      x.users.add(e.user);
    }

    // Pr. time og ugedag (sidevisninger)
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, pageviews: 0 }));
    const byWeekday = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"].map(n => ({ day: n, pageviews: 0 }));
    for (const e of views) { byHour[e.hour].pageviews++; byWeekday[(e.weekday + 6) % 7].pageviews++; }

    // Brugere
    const users = {};
    for (const e of events) {
      const u = users[e.user] = users[e.user] || { user: e.user, pageviews: 0, clicks: 0, days: new Set(), lastSeen: e.ts };
      if (e.type === "PageView") u.pageviews++; else u.clicks++;
      u.days.add(e.date);
      if (e.ts > u.lastSeen) u.lastSeen = e.ts;
    }

    const activeDays = Object.values(byDay).filter(x => x.users.size > 0);

    return json(context, 200, {
      from, to, hasClickColumns,
      totals: {
        pageviews: views.length,
        clicks: clicks.length,
        uniqueUsers: Object.keys(users).length,
        avgUsersPerActiveDay: activeDays.length ? Math.round(activeDays.reduce((t, x) => t + x.users.size, 0) / activeDays.length * 10) / 10 : 0
      },
      byDay: Object.values(byDay).map(x => ({ date: x.date, pageviews: x.pageviews, clicks: x.clicks, uniqueUsers: x.users.size })),
      byHour,
      byWeekday,
      pages: groupCount(views, e => e.path, 30),
      tiles: groupCount(clicks, e => e.title || e.url || "(uden navn)", 50, e => ({ category: e.category, url: e.url })),
      categories: groupCount(clicks, e => e.category || "(ingen kategori)", 30),
      devices: groupCount(views, e => e.device, 10),
      browsers: groupCount(views, e => e.browser, 10),
      users: Object.values(users)
        .map(u => ({ user: u.user, pageviews: u.pageviews, clicks: u.clicks, activeDays: u.days.size, lastSeen: u.lastSeen }))
        .sort((a, b) => (b.pageviews + b.clicks) - (a.pageviews + a.clicks))
        .slice(0, 100),
      truncated: rows.length >= MAX_ROWS
    });
  } catch (e) {
    context.log("PORTALSTATS ERROR", e.message);
    return json(context, 500, { error: "Unhandled", details: e.message });
  }
};

// ============ Hjælpere ============

async function getRows(cols, filter) {
  let path = `${ENTITY_SET}?$select=${cols.join(",")}&$filter=${encodeURIComponent(filter)}&$orderby=cr175_lch_timestamputc asc`;
  const rows = [];
  while (path && rows.length < MAX_ROWS) {
    const data = await dvFetch(path, { headers: { Prefer: "odata.maxpagesize=5000" } });
    rows.push(...(data?.value || []));
    const next = data?.["@odata.nextLink"] || "";
    // nextLink er en fuld URL - dvFetch vil have stien efter /api/data/v9.2/
    path = next ? next.split("/api/data/v9.2/")[1] : "";
  }
  return rows;
}

// Tæller pr. nøgle: antal og unikke brugere. extra() giver ekstra felter fra første forekomst.
function groupCount(list, keyFn, limit, extra) {
  const map = {};
  for (const e of list) {
    const k = keyFn(e);
    const x = map[k] = map[k] || { key: k, count: 0, users: new Set(), ...(extra ? extra(e) : {}) };
    x.count++;
    x.users.add(e.user);
  }
  return Object.values(map)
    .map(({ users, ...x }) => ({ ...x, uniqueUsers: users.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function normalizePath(p) {
  let s = String(p || "/").trim() || "/";
  if (s === "/" || s === "/index.html") return "/ (forside)";
  return s.replace(/\.html$/i, "");
}

function device(ua) {
  const s = String(ua || "");
  if (/iPad|Tablet/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) return "Tablet";
  if (/Mobi|iPhone|Android/i.test(s)) return "Mobil";
  return s ? "Computer" : "Ukendt";
}

function browser(ua) {
  const s = String(ua || "");
  if (/Edg\//.test(s)) return "Edge";
  if (/OPR\//.test(s)) return "Opera";
  if (/Firefox\//.test(s)) return "Firefox";
  if (/Chrome\//.test(s) || /CriOS/.test(s)) return "Chrome";
  if (/Safari\//.test(s)) return "Safari";
  return s ? "Andet" : "Ukendt";
}

function pad(n) { return String(n).padStart(2, "0"); }
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}
function localDate(dt) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(dt);
}
function localParts(dt) {
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).format(dt);
  const [date, hour] = s.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  return { date, hour: Number(hour), weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
// Dansk midnat for datoen i UTC, fx "2026-09-30T22:00:00Z"
function localMidnightUtc(dateIso) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d - 1, 23, 30));
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(probe).find(p => p.type === "timeZoneName")?.value || "GMT+01:00";
  const off = name === "GMT" ? "+00:00" : name.replace("GMT", "");
  return new Date(`${dateIso}T00:00:00${off}`).toISOString().replace(".000Z", "Z");
}
