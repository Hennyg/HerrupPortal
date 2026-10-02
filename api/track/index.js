// /api/track/index.js
//
// Logger sidevisninger og klik på tiles til Dataverse-tabellen lch_accesslog
// (entity set: cr175_lch_accesslogs - kan ændres via app-indstillingen
// ACCESSLOG_ENTITY_SET). Kaldes fra assets/app.js (index.html) og
// assets/track.js (øvrige sider).
//
// Brugeren tages fra SWA's eget login (x-ms-client-principal) - klienten
// kan ikke selv angive hvem den er.
//
// Kolonner (Web API bruger de logiske navne = små bogstaver):
//   cr175_lch_useremail, cr175_lch_timestamputc, cr175_lch_url, cr175_lch_path,
//   cr175_lch_querystring, cr175_lch_referrer, cr175_lch_clientip,
//   cr175_lch_useragent
// Valgfri (til klik-statistik) - oprettes som "Tekst på enkelt linje":
//   cr175_lch_eventtype (50), cr175_lch_targettitle (200),
//   cr175_lch_targeturl (1000), cr175_lch_targetcategory (100)
// Findes de valgfri kolonner ikke, gemmes sidevisninger alligevel (uden dem),
// mens klik springes over, da de ellers ville ligne sidevisninger.

const { dvFetch } = require("../_dv");

const ENTITY_SET = process.env.ACCESSLOG_ENTITY_SET || "cr175_lch_accesslogs";
const EVENT_TYPES = ["PageView", "Click"];

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body
  };
}

function getClientPrincipal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function pickEmail(cp) {
  if (!cp) return "";
  const claims = Array.isArray(cp.claims) ? cp.claims : [];
  const getClaim = (t) => claims.find(c => c.typ === t)?.val;
  return String(getClaim("preferred_username") || getClaim("upn") || cp.userDetails || "").toLowerCase();
}

const cut = (v, n) => String(v ?? "").substring(0, n);

module.exports = async function (context, req) {
  try {
    const cp = getClientPrincipal(req);
    const userEmail = pickEmail(cp);
    const body = req.body || {};

    const eventType = EVENT_TYPES.includes(body.eventType) ? body.eventType : "PageView";
    const pageUrl = cut(body.pageUrl, 1000);

    let queryString = "";
    try { queryString = cut(new URL(pageUrl).search, 1000); } catch { /* ugyldig URL */ }

    const base = {
      cr175_lch_useremail: cut(userEmail, 100),
      cr175_lch_timestamputc: new Date().toISOString(),
      cr175_lch_url: pageUrl,
      cr175_lch_path: cut(body.path, 300),
      cr175_lch_querystring: queryString,
      cr175_lch_referrer: cut(body.referrer, 1000),
      cr175_lch_clientip: cut(String(req.headers["x-forwarded-for"] || "").split(",")[0].trim(), 100),
      cr175_lch_useragent: cut(req.headers["user-agent"], 500)
    };

    const extra = {
      cr175_lch_eventtype: eventType,
      cr175_lch_targettitle: cut(body.targetTitle, 200),
      cr175_lch_targeturl: cut(body.targetUrl, 1000),
      cr175_lch_targetcategory: cut(body.targetCategory, 100)
    };

    try {
      await dvFetch(ENTITY_SET, { method: "POST", body: { ...base, ...extra } });
    } catch (e) {
      // Mangler de valgfri kolonner? Så gem kun sidevisningen uden dem.
      const missingColumn = e.status === 400 && /property|attribute|does not exist|not found/i.test(e.message);
      if (!missingColumn) throw e;
      if (eventType !== "PageView") return json(context, 200, { ok: false, skipped: "klik-kolonner mangler" });
      await dvFetch(ENTITY_SET, { method: "POST", body: base });
    }

    return json(context, 200, { ok: true });
  } catch (e) {
    context.log("TRACK ERROR", e.message);
    // Fejlen returneres, så den kan ses i browserens Network-fane
    return json(context, 200, { ok: false, error: "track_failed", details: cut(e.message, 500) });
  }
};
