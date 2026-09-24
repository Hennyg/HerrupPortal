// /api/_sms.js
// Fælles hjælpefunktioner til SMS service: kolonnenavne, adgang, nummer-
// validering, SMS-tælling og kald til Sveve.
const fetch = globalThis.fetch;
const { dvFetch } = require("./_dv");

// ── Dataverse-tabel ─────────────────────────────────────────────────────────
// Logisk navn: cr175_lch_sms_service  →  entity set: cr175_lch_sms_services
const TABLE = process.env.SMS_DV_ENTITYSET || "cr175_lch_sms_services";
const IDCOL = "cr175_lch_sms_serviceid";
const COL = {
  titel:          "cr175_lch_titel",          // Tekst (primær kolonne)
  modtagere:      "cr175_lch_modtagere",      // Tekst, flere linjer
  besked:         "cr175_lch_besked",         // Tekst, flere linjer
  afsender:       "cr175_lch_afsender",       // Tekst – navn på medarbejder
  afsenderMail:   "cr175_lch_afsendermail",   // Tekst – mail på medarbejder
  fra:            "cr175_lch_fra",            // Tekst – afsendernavn på SMS'en
  test:           "cr175_lch_test",           // Ja/Nej
  antalSms:       "cr175_lch_antalsms",       // Heltal
  antalModtagere: "cr175_lch_antalmodtagere", // Heltal
  sendt:          "cr175_lch_sendt",          // Dato og klokkeslæt
  status:         "cr175_lch_status",         // Tekst
  svar:           "cr175_lch_svar",           // Tekst, flere linjer
  spId:           "cr175_lch_spid"            // Heltal – ID fra SharePoint-listen
};

// ── Konfiguration ───────────────────────────────────────────────────────────
function smsRoles() {
  return String(process.env.SMS_ROLES || "portal_sms,portal_admin")
    .split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
const ADMIN_ROLES = ["portal_admin", "portal_herrup_portal_admin"];
const SMS_PRICE = Number(process.env.SMS_PRICE || "0.37");
const SVEVE_BASE = (process.env.SVEVE_BASE_URL || "https://api.sveve.dk").replace(/\/+$/, "");

// ── Svar-hjælper ────────────────────────────────────────────────────────────
function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

// ── Bruger og roller fra SWA-login ─────────────────────────────────────────
function getPrincipal(req) {
  const b64 = req.headers["x-ms-client-principal"];
  if (!b64) return null;
  try {
    const cp = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const claims = cp.claims || [];
    const claim = (...types) => {
      const c = claims.find(x => types.includes(String(x.typ || "").toLowerCase()));
      return c ? String(c.val || "") : "";
    };
    const roles = new Set((cp.userRoles || []).map(r => String(r).toLowerCase()));
    claims
      .filter(c => {
        const t = String(c.typ || "").toLowerCase();
        return t === "roles" || t === "role" || t.endsWith("/identity/claims/role");
      })
      .forEach(c => roles.add(String(c.val || "").toLowerCase()));
    return {
      email: cp.userDetails || claim("preferred_username", "email"),
      name: claim("name") || cp.userDetails || "",
      roles: [...roles]
    };
  } catch {
    return null;
  }
}

// Returnerer brugeren, eller sætter 401/403-svar og returnerer null.
function requireAccess(context, req, { admin = false } = {}) {
  const user = getPrincipal(req);
  if (!user) { json(context, 401, { error: "Ikke logget ind" }); return null; }
  const allowed = admin ? ADMIN_ROLES : smsRoles();
  if (!user.roles.some(r => allowed.includes(r))) {
    json(context, 403, { error: admin ? "Kræver admin-rolle" : "Du har ikke adgang til SMS service" });
    return null;
  }
  return user;
}

// ── Telefonnumre ────────────────────────────────────────────────────────────
// Et nummer pr. linje (komma og semikolon accepteres også). Mellemrum,
// bindestreger og "+" fjernes, "00" foran fjernes, og 8-cifrede numre får 45 foran.
function parseNumbers(input) {
  const raw = Array.isArray(input) ? input : String(input || "").split(/[\r\n,;]+/);
  const valid = [], invalid = [], seen = new Set();
  let duplicates = 0;
  for (const line of raw) {
    const orig = String(line || "").trim();
    if (!orig) continue;
    let n = orig.replace(/[\s\-().]/g, "").replace(/^\+/, "");
    if (n.startsWith("00")) n = n.slice(2);
    if (/^\d{8}$/.test(n)) n = "45" + n;
    if (!/^\d{10,15}$/.test(n)) { invalid.push(orig); continue; }
    if (seen.has(n)) { duplicates++; continue; }
    seen.add(n);
    valid.push(n);
  }
  return { valid, invalid, duplicates };
}

// ── SMS-tælling (GSM-7 = 160/153 tegn, ellers Unicode = 70/67 tegn) ────────
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";
function smsInfo(text) {
  const t = String(text || "");
  let gsm = true, len = 0;
  for (const ch of t) {
    if (GSM_BASIC.includes(ch)) len += 1;
    else if (GSM_EXT.includes(ch)) len += 2;
    else { gsm = false; break; }
  }
  if (!gsm) len = [...t].length;
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  const parts = len === 0 ? 0 : (len <= single ? 1 : Math.ceil(len / multi));
  return { length: len, parts, encoding: gsm ? "GSM" : "Unicode" };
}

// ── Sveve ───────────────────────────────────────────────────────────────────
function sveveCredentials() {
  const user = process.env.SVEVE_USER, passwd = process.env.SVEVE_PASSWD;
  if (!user || !passwd) throw new Error("Miljøvariablerne SVEVE_USER og SVEVE_PASSWD mangler");
  return { user, passwd };
}

async function sveveSend({ to, from, msg, test }) {
  const { user, passwd } = sveveCredentials();
  const body = new URLSearchParams({
    f: "json", user, passwd,
    to: to.join(","), from, msg,
    test: test ? "true" : "false"
  });
  // POST i stedet for URL-parametre: ingen grænse på URL-længde, og % og
  // linjeskift i beskeden kodes korrekt.
  const r = await fetch(`${SVEVE_BASE}/SMS/SendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body
  });
  const txt = await r.text();
  let data = null;
  try { data = JSON.parse(txt); } catch { data = null; }
  const resp = data?.response || data || {};
  return {
    httpStatus: r.status,
    raw: txt.slice(0, 4000),
    okCount: Number(resp.msgOkCount ?? 0),
    smsCount: Number(resp.stdSMSCount ?? resp.stdSmsCount ?? 0),
    fatalError: resp.fatalError || (r.ok ? "" : `HTTP ${r.status}`),
    errors: Array.isArray(resp.errors) ? resp.errors.map(e => ({ number: e.number, message: e.message })) : []
  };
}

async function sveveBalance() {
  const { user, passwd } = sveveCredentials();
  const url = `${SVEVE_BASE}/SMS/AccountAdm?` + new URLSearchParams({ cmd: "sms_count", user, passwd });
  const r = await fetch(url);
  const txt = (await r.text()).trim();
  if (!r.ok) throw new Error(`Sveve svarede HTTP ${r.status}`);
  const n = Number(txt.replace(/[^\d-]/g, ""));
  return { count: Number.isFinite(n) && txt.match(/\d/) ? n : null, raw: txt.slice(0, 500) };
}

// ── Dataverse: følg @odata.nextLink ────────────────────────────────────────
async function dvGetAll(path, maxPageSize = 5000) {
  const base = `${process.env.DV_URL}/api/data/v9.2/`;
  const rows = [];
  let next = path;
  while (next) {
    const rel = next.startsWith("http") ? next.replace(base, "") : next;
    const data = await dvFetch(rel, { headers: { Prefer: `odata.maxpagesize=${maxPageSize}` } });
    rows.push(...(data?.value || []));
    next = data?.["@odata.nextLink"] || null;
  }
  return rows;
}

function formatTitle(date) {
  // Dansk tid i titlen, fx "SMS 24-09-2026 14:30" (selve tidspunktet gemmes i "sendt").
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("da-DK", {
      timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(new Date(date)).map(p => [p.type, p.value])
  );
  return `SMS ${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}`;
}

module.exports = {
  TABLE, IDCOL, COL, SMS_PRICE, ADMIN_ROLES,
  json, getPrincipal, requireAccess,
  parseNumbers, smsInfo,
  sveveSend, sveveBalance,
  dvFetch, dvGetAll, formatTitle
};
