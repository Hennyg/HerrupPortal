// /api/_unicontaAccess.js
// Fælles adgangsstyring til Uniconta-siderne. Hver underside har sin egen
// portal-rolle (app role / gruppe på login-app'en). Rollerne slås op i Graph,
// da principal.claims er tomme i Functions-backend'en.
const fetch = globalThis.fetch;

function roleList(envName, fallback) {
  return String(process.env[envName] || fallback)
    .split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

const ADMIN_ROLES = ["portal_admin", "portal_herrup_portal_admin"];

// Undersider på uniconta.html. Tilføj nye sider her.
const PAGES = [
  {
    key: "debitor",
    title: "Debitorer",
    description: "Debitorliste hentet direkte fra Uniconta",
    url: "/unicontadebitor.html",
    icon: "👥",
    roles: roleList("UNICONTA_DEBITOR_ROLES", "portal_uniconta_debitor")
  },
  {
    key: "varelager",
    title: "Varelager",
    description: "Slå et varenummer eller en stregkode op – også med scanner",
    url: "/uniconta_varelager.html",
    icon: "📦",
    roles: roleList("UNICONTA_VARELAGER_ROLES", "portal_uniconta_varelager")
  }
];

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

function canSee(user, page) {
  return user.roles.some(r => ADMIN_ROLES.includes(r) || page.roles.includes(r));
}

// Returnerer brugeren med .pages (de sider brugeren må se), eller sætter
// 401/403/500 og returnerer null. Med pageKey kræves adgang til netop den side.
async function requireUniconta(context, req, pageKey = null) {
  const user = getPrincipal(req);
  if (!user) { json(context, 401, { error: "Ikke logget ind" }); return null; }

  try {
    const token = await graphToken();
    const graphRoles = await getGraphRoles(user.userId, token);
    user.roles = [...new Set([...user.roles, ...graphRoles])];
  } catch (e) {
    context.log.warn("Rolleopslag i Graph fejlede:", e.message);
    json(context, 500, { error: `Kunne ikke slå roller op: ${e.message}` });
    return null;
  }

  user.pages = PAGES.filter(p => canSee(user, p));

  if (pageKey) {
    const page = PAGES.find(p => p.key === pageKey);
    if (!page || !canSee(user, page)) {
      json(context, 403, { error: "Du har ikke adgang til denne Uniconta-side" });
      return null;
    }
  } else if (!user.pages.length) {
    json(context, 403, { error: "Du har ikke adgang til Uniconta-siderne" });
    return null;
  }
  return user;
}

module.exports = { PAGES, json, requireUniconta };
