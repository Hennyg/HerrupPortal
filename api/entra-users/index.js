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

// ── Graph-fetch med paginering — extraHeaders kun til første kald ─────────────
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

    const page = j.value || [];
    console.log(`[graphGetAll] page: ${page.length} items, nextLink: ${j["@odata.nextLink"] ? "ja" : "nej"}, url: ${next.substring(0, 120)}`);

    items.push(...page);
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

// ── Hent gruppemedlemmer med paginering ───────────────────────────────────────
async function getGroupMembers(token, groupId) {
  // Max 100 per side — paginering håndteres automatisk via @odata.nextLink
  const url = `https://graph.microsoft.com/v1.0/groups/${groupId}/members/microsoft.graph.user?$select=${USER_FIELDS}&$top=100`;
  return graphGetAll(token, url);
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  try {
    const token   = await getGraphToken();
    const groupId = await findGroupId(token, GROUP_NAME);

    // DEBUG: returner rå Graph-svar for første side så vi kan se hvad vi får
    // Test uden type-cast og med $count for at se det fulde billede
    const firstUrl = `https://graph.microsoft.com/v1.0/groups/${groupId}/members?$top=100&$count=true`;
    const firstR = await fetch(firstUrl, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" } });
    const firstJ = await firstR.json();

    return json(context, 200, {
      groupId,
      firstPageCount: (firstJ.value || []).length,
      odataCount: firstJ["@odata.count"] ?? null,
      hasNextLink: !!firstJ["@odata.nextLink"],
      firstThree: (firstJ.value || []).slice(0, 3).map(u => ({ name: u.displayName, type: u["@odata.type"] })),
      rawKeys: Object.keys(firstJ)
    });
  } catch (e) {
    return json(context, 500, { error: e.message });
  }
};
