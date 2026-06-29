// api/entra-users/index.js
const fetch = globalThis.fetch;

const GROUP_NAME = "Alle - lely center herrup";

const USER_FIELDS = [
  "id", "displayName", "mail", "userPrincipalName",
  "jobTitle", "department", "mobilePhone", "officeLocation", "accountEnabled"
].join(",");

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

// ── Token ─────────────────────────────────────────────────────────────────────
async function getGraphToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;

  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Manglende miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID eller DV_CLIENT_SECRET");
  }

  const r = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default"
      })
    }
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

// ── Graph-fetch med paginering ────────────────────────────────────────────────
async function graphGetAll(token, url, extraHeaders = {}) {
  const items = [];
  let next = url;
  let firstCall = true;

  while (next) {
    const headers = { Authorization: `Bearer ${token}` };
    if (firstCall) Object.assign(headers, extraHeaders);
    firstCall = false;

    const r = await fetch(next, { headers });
    const j = await r.json();
    if (!r.ok) throw new Error(`graph_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
    items.push(...(j.value || []));
    next = j["@odata.nextLink"] || null;
  }

  return items;
}

// ── Find gruppe på displayName ────────────────────────────────────────────────
async function findGroupId(token, name) {
  const filter = encodeURIComponent(`displayName eq '${name}'`);
  const url = `https://graph.microsoft.com/v1.0/groups?$filter=${filter}&$select=id,displayName&$count=true`;
  const groups = await graphGetAll(token, url, { ConsistencyLevel: "eventual" });
  if (groups.length === 0) throw new Error(`Gruppe ikke fundet: "${name}"`);
  return groups[0].id;
}

// ── Hent alle brugere rekursivt via transitiveMembers ────────────────────────
async function getGroupMembers(token, groupId) {
  const url = `https://graph.microsoft.com/v1.0/groups/${groupId}/transitiveMembers/microsoft.graph.user?$select=${USER_FIELDS}&$top=100`;
  return graphGetAll(token, url);
}

// ── Hent foto som base64 (returnerer null hvis ingen) ────────────────────────
async function getPhoto(token, userId) {
  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/photos/48x48/$value`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const ct  = r.headers.get("content-type") || "image/jpeg";
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

// ── Hent manager (returnerer { id, displayName } eller null) ─────────────────
async function getManager(token, userId) {
  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/manager?$select=id,displayName`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    return { id: j.id, displayName: j.displayName };
  } catch {
    return null;
  }
}

// ── Kør i batches for at undgå for mange parallelle kald ─────────────────────
async function runBatched(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  try {
    const token   = await getGraphToken();
    const groupId = await findGroupId(token, GROUP_NAME);
    const members = await getGroupMembers(token, groupId);

    // Hent foto + manager for alle brugere i batches af 10
    const enriched = await runBatched(members, 10, async (user) => {
      const [photo, manager] = await Promise.all([
        getPhoto(token, user.id),
        getManager(token, user.id)
      ]);
      return { ...user, photo, managerId: manager?.id || null, managerName: manager?.displayName || null };
    });

    enriched.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "da"));
    return json(context, 200, enriched);
  } catch (e) {
    context.log("entra-users ERROR:", e.message);
    return json(context, 500, { error: e.message });
  }
};
