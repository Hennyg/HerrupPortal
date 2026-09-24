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
  titel:          "cr175_lch_key",            // Tekst (primær kolonne "lch_key")
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

// ── Bruger og roller ────────────────────────────────────────────────────────
// principal.claims er altid tom i Azure Functions-backend'en (kun /.auth/me i
// browseren har dem). Rollerne slås derfor op i Graph mod login-app'en
// (AZURE_CLIENT_ID) – både direkte bruger-tildelinger og tildelinger via
// grupper (fx gruppen portal_sms lagt på appen).
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
    roles.delete("anonymous");
    roles.delete("authenticated");
    return {
      userId: cp.userId || "",
      email: cp.userDetails || claim("preferred_username", "email"),
      name: claim("name") || "",
      roles: [...roles]
    };
  } catch {
    return null;
  }
}

async function graphToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DV_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.DV_CLIENT_ID,
      client_secret: process.env.DV_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default"
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Graph token-fejl ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

async function graphJson(token, url, opts = {}) {
  const r = await fetch(url.startsWith("http") ? url : `https://graph.microsoft.com/v1.0/${url}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Graph ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
  return j;
}

// Rolletildelinger på login-app'en caches 5 min pr. instans.
let assignCache = { at: 0, data: null };
async function getAppAssignments(token) {
  if (assignCache.data && Date.now() - assignCache.at < 5 * 60 * 1000) return assignCache.data;
  const appId = process.env.AZURE_CLIENT_ID;
  if (!appId) throw new Error("Miljøvariablen AZURE_CLIENT_ID mangler");
  const spRes = await graphJson(token, `servicePrincipals?$filter=appId eq '${appId}'&$select=id,appRoles`);
  const sp = (spRes.value || [])[0];
  if (!sp) throw new Error("Service principal ikke fundet for AZURE_CLIENT_ID");
  const roleName = new Map((sp.appRoles || []).map(r => [r.id, String(r.value || "").toLowerCase()]));

  const byUser = new Map();  // userId  -> Set(roller)
  const byGroup = new Map(); // groupId -> Set(roller)
  let url = `servicePrincipals/${sp.id}/appRoleAssignedTo?$top=999`;
  while (url) {
    const j = await graphJson(token, url);
    for (const a of j.value || []) {
      const role = roleName.get(a.appRoleId);
      if (!role) continue;
      const map = a.principalType === "Group" ? byGroup : (a.principalType === "User" ? byUser : null);
      if (!map) continue;
      if (!map.has(a.principalId)) map.set(a.principalId, new Set());
      map.get(a.principalId).add(role);
    }
    url = j["@odata.nextLink"] || null;
  }
  assignCache = { at: Date.now(), data: { byUser, byGroup } };
  return assignCache.data;
}

async function getGraphRoles(userId, token) {
  if (!userId) return [];
  const { byUser, byGroup } = await getAppAssignments(token);
  const roles = new Set(byUser.get(userId) || []);

  // Hvilke af de tildelte grupper er brugeren medlem af (også indirekte)?
  const groupIds = [...byGroup.keys()];
  for (let i = 0; i < groupIds.length; i += 20) {
    const chunk = groupIds.slice(i, i + 20);
    const j = await graphJson(token, `users/${userId}/checkMemberGroups`, {
      method: "POST",
      body: JSON.stringify({ groupIds: chunk })
    });
    for (const gid of j.value || []) (byGroup.get(gid) || []).forEach(r => roles.add(r));
  }
  return [...roles];
}

// Returnerer brugeren, eller sætter 401/403-svar og returnerer null.
async function requireAccess(context, req, { admin = false } = {}) {
  const user = getPrincipal(req);
  if (!user) { json(context, 401, { error: "Ikke logget ind" }); return null; }

  let token = null;
  try {
    token = await graphToken();
    const graphRoles = await getGraphRoles(user.userId, token);
    user.roles = [...new Set([...user.roles, ...graphRoles])];
  } catch (e) {
    context.log.warn("Rolleopslag i Graph fejlede:", e.message);
    json(context, 500, { error: `Kunne ikke slå roller op: ${e.message}` });
    return null;
  }

  const allowed = admin ? ADMIN_ROLES : [...smsRoles(), ...ADMIN_ROLES];
  if (!user.roles.some(r => allowed.includes(r))) {
    json(context, 403, { error: admin ? "Kræver admin-rolle" : "Du har ikke adgang til SMS service", roles: user.roles });
    return null;
  }
  // Fulde navn til loggen (claims er tomme i backend'en).
  if (!user.name && user.userId) {
    try {
      const u = await graphJson(token, `users/${user.userId}?$select=displayName`);
      user.name = u.displayName || "";
    } catch { /* ikke kritisk */ }
  }
  if (!user.name) user.name = user.email;
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

// Sender via GET (som den gamle PowerApps-app – Sveve svarer 404 på POST).
// URLSearchParams koder % og linjeskift korrekt. Modtagere sendes i bidder
// af 100, så URL'en ikke bliver for lang.
async function sveveSend({ to, from, msg, test }) {
  const { user, passwd } = sveveCredentials();
  const CHUNK = 100;
  const out = { httpStatus: 200, raw: "", okCount: 0, smsCount: 0, fatalError: "", errors: [] };
  const raws = [];

  for (let i = 0; i < to.length; i += CHUNK) {
    const qs = new URLSearchParams({
      f: "json", user, passwd,
      to: to.slice(i, i + CHUNK).join(","),
      from, msg,
      test: test ? "true" : "false"
    });
    const r = await fetch(`${SVEVE_BASE}/SMS/SendMessage?${qs}`);
    const txt = await r.text();
    raws.push(txt);
    let data = null;
    try { data = JSON.parse(txt); } catch { data = null; }
    const resp = data?.response || data || {};

    out.httpStatus = r.status;
    out.okCount += Number(resp.msgOkCount ?? 0);
    out.smsCount += Number(resp.stdSMSCount ?? resp.stdSmsCount ?? 0);
    if (Array.isArray(resp.errors)) out.errors.push(...resp.errors.map(e => ({ number: e.number, message: e.message })));
    const fatal = resp.fatalError || (r.ok ? "" : `Sveve svarede HTTP ${r.status}`);
    if (fatal) {
      // Stop ved fatal fejl – de resterende bidder sendes ikke.
      out.fatalError = out.okCount ? `${fatal} (efter ${out.okCount} sendte)` : fatal;
      break;
    }
  }
  out.raw = raws.join("\n").slice(0, 4000);
  return out;
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
  json, getPrincipal, requireAccess, graphToken, graphJson,
  parseNumbers, smsInfo,
  sveveSend, sveveBalance,
  dvFetch, dvGetAll, formatTitle
};
