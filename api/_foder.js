// /api/_foder.js
// Fælles hjælpefunktioner til Foderrådgivning: tabeller, kolonner og adgang.
// Rolleopslag sker i Graph mod login-app'en (AZURE_CLIENT_ID) – samme princip
// som SMS service, da principal.claims er tomme i Functions-backend'en.
const fetch = globalThis.fetch;
const { dvFetch } = require("./_dv");

// ── Dataverse-tabeller (HerrupPortal-miljøet, cr175_) ──────────────────────
// Opgaver:        skemanavn cr175_lch_foder_opgaves        → entity set cr175_lch_foder_opgaveses
// Registreringer: skemanavn cr175_lch_foder_registrerings  → entity set cr175_lch_foder_registreringses
const OPG = {
  TABLE: process.env.FODER_OPGAVE_ENTITYSET || "cr175_lch_foder_opgaveses",
  ID: "cr175_lch_foder_opgavesid",
  navn: "cr175_lch_navn",             // Tekst (primær kolonne)
  sortering: "cr175_lch_sortering",   // Heltal
  aktiv: "cr175_lch_aktiv"            // Ja/Nej (standard Ja)
};

const REG = {
  TABLE: process.env.FODER_REG_ENTITYSET || "cr175_lch_foder_registreringses",
  ID: "cr175_lch_foder_registreringsid",
  titel: "cr175_lch_key",                   // Tekst (primær kolonne)
  kundenr: "cr175_lch_kundenr",             // Tekst
  kundenavn: "cr175_lch_kundenavn",         // Tekst
  dato: "cr175_lch_dato",                   // Kun dato
  minutter: "cr175_lch_minutter",           // Heltal – samlet tid i minutter
  opgaver: "cr175_lch_opgaver",             // Tekst, flere linjer – navne adskilt af linjeskift
  kommentar: "cr175_lch_kommentar",         // Tekst, flere linjer
  raadgiver: "cr175_lch_raadgiver",         // Tekst – navn
  raadgiverMail: "cr175_lch_raadgivermail", // Tekst – mail
  faktureret: "cr175_lch_faktureret",       // Ja/Nej (standard Nej)
  faktureretDato: "cr175_lch_faktureretdato", // Dato og klokkeslæt
  faktureretAf: "cr175_lch_faktureretaf"    // Tekst
};

// ── Roller ─────────────────────────────────────────────────────────────────
function roleList(envName, fallback) {
  return String(process.env[envName] || fallback)
    .split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
const ADMIN_ROLES = roleList("FODER_ADMIN_ROLES", "portal_foder_admin,portal_admin,portal_herrup_portal_admin");
const USER_ROLES = roleList("FODER_ROLES", "portal_foder");

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

function getPrincipal(req) {
  const b64 = req.headers["x-ms-client-principal"];
  if (!b64) return null;
  try {
    const cp = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const roles = new Set((cp.userRoles || []).map(r => String(r).toLowerCase()));
    roles.delete("anonymous");
    roles.delete("authenticated");
    return { userId: cp.userId || "", email: cp.userDetails || "", name: "", roles: [...roles] };
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

  const byUser = new Map();
  const byGroup = new Map();
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
  const groupIds = [...byGroup.keys()];
  for (let i = 0; i < groupIds.length; i += 20) {
    const j = await graphJson(token, `users/${userId}/checkMemberGroups`, {
      method: "POST",
      body: JSON.stringify({ groupIds: groupIds.slice(i, i + 20) })
    });
    for (const gid of j.value || []) (byGroup.get(gid) || []).forEach(r => roles.add(r));
  }
  return [...roles];
}

// Returnerer brugeren (med isAdmin), eller sætter 401/403 og returnerer null.
async function requireAccess(context, req, { admin = false } = {}) {
  const user = getPrincipal(req);
  if (!user) { json(context, 401, { error: "Ikke logget ind" }); return null; }

  let token;
  try {
    token = await graphToken();
    const graphRoles = await getGraphRoles(user.userId, token);
    user.roles = [...new Set([...user.roles, ...graphRoles])];
  } catch (e) {
    context.log.warn("Rolleopslag i Graph fejlede:", e.message);
    json(context, 500, { error: `Kunne ikke slå roller op: ${e.message}` });
    return null;
  }

  user.isAdmin = user.roles.some(r => ADMIN_ROLES.includes(r));
  const hasUser = user.isAdmin || user.roles.some(r => USER_ROLES.includes(r));

  if (admin ? !user.isAdmin : !hasUser) {
    json(context, 403, { error: admin ? "Kræver admin-rolle til Foderrådgivning" : "Du har ikke adgang til Foderrådgivning" });
    return null;
  }

  try {
    const u = await graphJson(token, `users/${user.userId}?$select=displayName,mail`);
    user.name = u.displayName || "";
    if (!user.email) user.email = u.mail || "";
  } catch { /* ikke kritisk */ }
  if (!user.name) user.name = user.email;
  return user;
}

async function fetchAll(path) {
  const baseUrl = `${process.env.DV_URL}/api/data/v9.2/`;
  let rows = [];
  let next = path;
  while (next) {
    const data = await dvFetch(next, { headers: { Prefer: "odata.maxpagesize=5000" } });
    rows = rows.concat(data?.value || []);
    const nl = data?.["@odata.nextLink"];
    next = nl && nl.startsWith(baseUrl) ? nl.slice(baseUrl.length) : null;
  }
  return rows;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

function cleanId(v) {
  const s = String(v || "").trim();
  return /^[0-9a-f-]{36}$/i.test(s) ? s : "";
}

module.exports = { OPG, REG, json, requireAccess, dvFetch, fetchAll, readBody, cleanId };
