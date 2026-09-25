// /api/_news.js
// Fælles for nyheder/tips (tabel lch_tip) og nyhedsbilleder (lch_nyhedsbillede).
const fetch = globalThis.fetch;

// ── Tabeller og kolonner ────────────────────────────────────────────────────
const TIP_SET = "cr175_lch_tips";
const TIP_ID = "cr175_lch_tipid";
const T = {
  overskrift:   "cr175_lch_overskrift",
  indhold:      "cr175_lch_indhold",      // kort besked (vises på forsiden)
  brodtekst:    "cr175_lch_brodtekst",    // hele teksten (HTML)
  valg:         "cr175_lch_valg",
  udlobsdato:   "cr175_lch_udlobsdato",   // hvornår den forsvinder fra forsiden
  aktiv:        "cr175_lch_aktiv",        // tekst "Ja"/"Nej"
  videourl:     "cr175_lch_videourl",
  bannertekst:  "cr175_lch_bannertekst",
  bannercolor:  "cr175_lch_bannercolor",
  bannerTile:   "cr175_lch_banner_tile",
  bannerNavbar: "cr175_lch_banner_navbar",
  bannerSlut:   "cr175_lch_banner_slut",
  bannerVisning:"cr175_lch_banner_visning", // "alle", "test" eller "mig:<mail>"
  indsender:    "cr175_lch_indsender"       // "Navn <mail>" når en medarbejder har indsendt
};
const VALG = { nyhed: 245500000, tip: 245500001, olkassemode: 245500002 };
const VALG_NAME = { 245500000: "nyhed", 245500001: "tip", 245500002: "olkassemode" };

const IMG_LOGICAL = "cr175_lch_nyhedsbillede";
const IMG_ID = "cr175_lch_nyhedsbilledeid";
const I = {
  navn: "cr175_lch_navn",
  mimetype: "cr175_lch_mimetype",
  fil: "cr175_lch_fil",
  tipLookup: "cr175_lch_tip",
  tipValue: "_cr175_lch_tip_value"
};

const EDITOR_ROLES = ["portal_hp_nyheder", "portal_admin", "portal_herrup_portal_admin"];

// ── Svar ────────────────────────────────────────────────────────────────────
function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body
  };
}

// ── Dataverse (samme miljø og app-registrering som /api/tips) ───────────────
let dvTokenCache = { token: null, exp: 0 };
async function dvToken() {
  if (dvTokenCache.token && Date.now() < dvTokenCache.exp) return dvTokenCache.token;
  const tenant = process.env.DV_TENANT_ID;
  const clientId = process.env.HerrupPortal_ClientID;
  const secret = process.env.HerrupPortal_ClientSecret;
  const dvUrl = process.env.DV_HerrupPortal_URL;
  const missing = [];
  if (!tenant) missing.push("DV_TENANT_ID");
  if (!clientId) missing.push("HerrupPortal_ClientID");
  if (!secret) missing.push("HerrupPortal_ClientSecret");
  if (!dvUrl) missing.push("DV_HerrupPortal_URL");
  if (missing.length) throw new Error("Manglende miljøvariabler: " + missing.join(", "));

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: secret,
      scope: `${dvUrl}/.default`
    })
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Dataverse token-fejl ${r.status}: ${j.error_description || j.error}`);
  dvTokenCache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in || 3600) - 300) * 1000 };
  return j.access_token;
}

async function dv(path, options = {}) {
  const token = await dvToken();
  const base = `${process.env.DV_HerrupPortal_URL}/api/data/v9.2/`;
  const isBinary = options.binary !== undefined;
  const r = await fetch(path.startsWith("http") ? path : base + path, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json",
      ...(isBinary ? {} : { "Content-Type": "application/json; charset=utf-8" }),
      ...(options.headers || {})
    },
    body: isBinary ? options.binary : (options.body ? JSON.stringify(options.body) : undefined)
  });
  if (options.raw) {
    if (!r.ok) throw Object.assign(new Error(`Dataverse ${r.status}`), { status: r.status });
    return r;
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const e = new Error(data?.error?.message || text || `Dataverse ${r.status}`);
    e.status = r.status;
    throw e;
  }
  // Id fra OData-EntityId ved oprettelse
  if (!data && r.headers.get("OData-EntityId")) {
    const m = /\(([0-9a-f-]{36})\)/i.exec(r.headers.get("OData-EntityId"));
    return { id: m ? m[1] : null };
  }
  return data;
}

// Entity set og navigation-property til billedtabellen slås op i metadata,
// så vi ikke gætter på navnene.
let imgMeta = null;
async function imageMeta() {
  if (imgMeta) return imgMeta;
  let entitySet = process.env.NEWS_IMAGE_ENTITYSET || "cr175_lch_nyhedsbilledes";
  let navProp = process.env.NEWS_IMAGE_NAVPROP || I.tipLookup;
  try {
    const e = await dv(`EntityDefinitions(LogicalName='${IMG_LOGICAL}')?$select=EntitySetName`);
    if (e?.EntitySetName) entitySet = e.EntitySetName;
    const rel = await dv(`EntityDefinitions(LogicalName='${IMG_LOGICAL}')/ManyToOneRelationships?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName`);
    const hit = (rel?.value || []).find(x => x.ReferencingAttribute === I.tipLookup);
    if (hit?.ReferencingEntityNavigationPropertyName) navProp = hit.ReferencingEntityNavigationPropertyName;
  } catch {
    // Falder tilbage til standardnavnene
  }
  imgMeta = { entitySet, navProp };
  return imgMeta;
}

// ── Roller (claims er tomme i backend'en → slå op i Graph) ─────────────────
function getPrincipal(req) {
  const b64 = req.headers["x-ms-client-principal"];
  if (!b64) return null;
  try {
    const cp = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const roles = new Set((cp.userRoles || []).map(r => String(r).toLowerCase()));
    (cp.claims || [])
      .filter(c => ["roles", "role"].includes(String(c.typ || "").toLowerCase()) || String(c.typ || "").toLowerCase().endsWith("/identity/claims/role"))
      .forEach(c => roles.add(String(c.val || "").toLowerCase()));
    roles.delete("anonymous");
    roles.delete("authenticated");
    return { userId: cp.userId || "", email: cp.userDetails || "", roles: [...roles] };
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
  if (!r.ok) throw new Error(`Graph token-fejl ${r.status}: ${j.error_description || j.error}`);
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

let assignCache = { at: 0, data: null };
async function appAssignments(token) {
  if (assignCache.data && Date.now() - assignCache.at < 5 * 60 * 1000) return assignCache.data;
  const appId = process.env.AZURE_CLIENT_ID;
  const spRes = await graphJson(token, `servicePrincipals?$filter=appId eq '${appId}'&$select=id,appRoles`);
  const sp = (spRes.value || [])[0];
  if (!sp) throw new Error("Service principal ikke fundet for AZURE_CLIENT_ID");
  const roleName = new Map((sp.appRoles || []).map(r => [r.id, String(r.value || "").toLowerCase()]));
  const byUser = new Map(), byGroup = new Map();
  let url = `servicePrincipals/${sp.id}/appRoleAssignedTo?$top=999`;
  while (url) {
    const j = await graphJson(token, url);
    for (const a of j.value || []) {
      const role = roleName.get(a.appRoleId);
      const map = a.principalType === "Group" ? byGroup : (a.principalType === "User" ? byUser : null);
      if (!role || !map) continue;
      if (!map.has(a.principalId)) map.set(a.principalId, new Set());
      map.get(a.principalId).add(role);
    }
    url = j["@odata.nextLink"] || null;
  }
  assignCache = { at: Date.now(), data: { byUser, byGroup } };
  return assignCache.data;
}

// Slår brugerens app-roller op i Graph (direkte og via grupper)
async function lookupRoles(user) {
  const token = await graphToken();
  const { byUser, byGroup } = await appAssignments(token);
  const roles = new Set([...user.roles, ...(byUser.get(user.userId) || [])]);
  const groupIds = [...byGroup.keys()];
  for (let i = 0; i < groupIds.length; i += 20) {
    const j = await graphJson(token, `users/${user.userId}/checkMemberGroups`, {
      method: "POST",
      body: JSON.stringify({ groupIds: groupIds.slice(i, i + 20) })
    });
    for (const gid of j.value || []) (byGroup.get(gid) || []).forEach(r => roles.add(r));
  }
  return [...roles];
}

const hasEditorRole = roles => roles.some(r => EDITOR_ROLES.includes(r));

async function requireEditor(context, req) {
  const user = getPrincipal(req);
  if (!user) { json(context, 401, { error: "Ikke logget ind" }); return null; }
  try {
    user.roles = await lookupRoles(user);
  } catch (e) {
    json(context, 500, { error: `Kunne ikke slå roller op: ${e.message}` });
    return null;
  }
  if (!hasEditorRole(user.roles)) {
    json(context, 403, { error: "Du har ikke adgang til at redigere nyheder", roles: user.roles });
    return null;
  }
  return user;
}

// ── Tekst og billeder ───────────────────────────────────────────────────────
const IMG_REF = /\/api\/news-image\/([0-9a-f-]{36})/gi;

// Fjerner scripts, event-attributter og javascript:-links. Visningen renser
// også med DOMPurify, så dette er et ekstra lag.
function cleanHtml(html) {
  return String(html || "")
    .replace(/<\s*(script|style|iframe|object|embed|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|meta|link)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

// Knyt billeder i teksten til nyheden, og slet dem der ikke længere bruges.
async function syncImages(tipId, html) {
  const { entitySet, navProp } = await imageMeta();
  const used = new Set([...String(html || "").matchAll(IMG_REF)].map(m => m[1].toLowerCase()));

  const linked = await dv(`${entitySet}?$select=${IMG_ID}&$filter=${I.tipValue} eq ${tipId}`);
  const linkedIds = new Set((linked?.value || []).map(r => String(r[IMG_ID]).toLowerCase()));

  for (const id of used) {
    if (linkedIds.has(id)) continue;
    try {
      await dv(`${entitySet}(${id})`, { method: "PATCH", body: { [`${navProp}@odata.bind`]: `/${TIP_SET}(${tipId})` } });
    } catch { /* billedet findes ikke længere */ }
  }
  for (const id of linkedIds) {
    if (!used.has(id)) {
      try { await dv(`${entitySet}(${id})`, { method: "DELETE" }); } catch { /* ignoreres */ }
    }
  }

  // Oprydning: billeder uploadet men aldrig gemt i en nyhed (ældre end 2 dage)
  try {
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString();
    const orphans = await dv(`${entitySet}?$select=${IMG_ID}&$filter=${I.tipValue} eq null and createdon lt ${cutoff}&$top=50`);
    for (const r of orphans?.value || []) {
      try { await dv(`${entitySet}(${r[IMG_ID]})`, { method: "DELETE" }); } catch { /* ignoreres */ }
    }
  } catch { /* ignoreres */ }
}

// ── Mapping ─────────────────────────────────────────────────────────────────
const yes = v => ["ja", "true", "1", "aktiv", "yes"].includes(String(v ?? "").trim().toLowerCase());

function bannerActive(row, now = new Date()) {
  if (!String(row[T.bannertekst] || "").trim()) return false;
  if (row[T.bannerTile] !== true && row[T.bannerNavbar] !== true) return false;
  if (row[T.bannerSlut] && new Date(row[T.bannerSlut]) < now) return false;
  return true;
}

function frontpageActive(row, now = new Date()) {
  if (!yes(row[T.aktiv])) return false;
  if (!row[T.udlobsdato]) return true;
  const end = new Date(`${String(row[T.udlobsdato]).slice(0, 10)}T23:59:59`);
  return !Number.isNaN(end.getTime()) && end >= now;
}

// "alle" (standard), "test" (portal_admin + portal_hp_nyheder) eller "mig:<mail>"
function parseVisning(v) {
  const s = String(v || "").trim();
  if (s.toLowerCase().startsWith("mig:")) return { visning: "mig", ejer: s.slice(4).trim().toLowerCase() };
  if (s.toLowerCase() === "test") return { visning: "test", ejer: "" };
  return { visning: "alle", ejer: "" };
}

// Status gemmes i lch_aktiv: "Ja", "Nej", "Afventer" (indsendt, ikke godkendt), "Afvist"
function statusOf(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (yes(s)) return "aktiv";
  if (s === "afventer") return "afventer";
  if (s === "afvist") return "afvist";
  return "inaktiv";
}
const STATUS_TEXT = { aktiv: "Ja", inaktiv: "Nej", afventer: "Afventer", afvist: "Afvist" };

function mapRow(row, { withBody = false } = {}) {
  const body = row[T.brodtekst] || "";
  const out = {
    id: row[TIP_ID],
    type: VALG_NAME[row[T.valg]] || "nyhed",
    overskrift: row[T.overskrift] || "",
    indhold: row[T.indhold] || "",
    hasBody: !!String(body).replace(/<[^>]*>/g, "").trim() || /<img/i.test(body),
    videourl: row[T.videourl] || "",
    aktiv: yes(row[T.aktiv]),
    status: statusOf(row[T.aktiv]),
    indsender: row[T.indsender] || "",
    udlobsdato: row[T.udlobsdato] ? String(row[T.udlobsdato]).slice(0, 10) : null,
    banner: {
      tekst: row[T.bannertekst] || "",
      farve: row[T.bannercolor] || "",
      tile: row[T.bannerTile] === true,
      navbar: row[T.bannerNavbar] === true,
      slut: row[T.bannerSlut] || null,
      ...parseVisning(row[T.bannerVisning]),
      active: bannerActive(row)
    },
    createdon: row.createdon || null,
    modifiedon: row.modifiedon || null
  };
  if (withBody) out.brodtekst = body;
  return out;
}

const LIST_COLS = [TIP_ID, T.overskrift, T.indhold, T.valg, T.udlobsdato, T.aktiv, T.videourl,
  T.bannertekst, T.bannercolor, T.bannerTile, T.bannerNavbar, T.bannerSlut, T.bannerVisning, T.indsender, "createdon", "modifiedon"];

module.exports = {
  TIP_SET, TIP_ID, T, VALG, VALG_NAME, IMG_ID, I, EDITOR_ROLES, LIST_COLS,
  json, dv, imageMeta, getPrincipal, requireEditor, lookupRoles, hasEditorRole,
  yes, bannerActive, frontpageActive, parseVisning, statusOf, STATUS_TEXT, mapRow,
  cleanHtml, syncImages
};
