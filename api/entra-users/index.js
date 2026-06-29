// api/entra-users/index.js
// Henter alle medlemmer af gruppen "Alle - lely center herrup" via Microsoft Graph API.
// Miljøvariabler (sæt i SWA Application settings):
//   GRAPH_TENANT_ID     – dit tenant-id
//   GRAPH_CLIENT_ID     – app registration client id (med Group.Read.All + User.Read.All)
//   GRAPH_CLIENT_SECRET – client secret

const fetch = globalThis.fetch;

const GROUP_NAME = "Alle - lely center herrup";

const USER_FIELDS = [
  "id",
  "displayName",
  "mail",
  "userPrincipalName",
  "jobTitle",
  "department",
  "mobilePhone",
  "officeLocation",
  "accountEnabled"
].join(",");

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body
  };
}

// ── Token ─────────────────────────────────────────────────────────────────────
async function getGraphToken() {
  const tenant = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Manglende miljøvariabler: GRAPH_TENANT_ID, GRAPH_CLIENT_ID eller GRAPH_CLIENT_SECRET");
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

// ── Graph-fetch med auto-paginering ──────────────────────────────────────────
async function graphGetAll(token, url) {
  const items = [];
  let next = url;

  while (next) {
    const r = await fetch(next, {
      headers: { Authorization: `Bearer ${token}`, "ConsistencyLevel": "eventual" }
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`graph_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
    items.push(...(j.value || []));
    next = j["@odata.nextLink"] || null;
  }

  return items;
}

// ── Find gruppe på displayName ────────────────────────────────────────────────
async function findGroupId(token, name) {
  const encoded = encodeURIComponent(`displayName eq '${name}'`);
  const url = `https://graph.microsoft.com/v1.0/groups?$filter=${encoded}&$select=id,displayName&$count=true`;
  const groups = await graphGetAll(token, url);
  if (groups.length === 0) throw new Error(`Gruppe ikke fundet: "${name}"`);
  return groups[0].id;
}

// ── Hent gruppemedlemmer (kun User-objekter) ──────────────────────────────────
async function getGroupMembers(token, groupId) {
  const url = `https://graph.microsoft.com/v1.0/groups/${groupId}/members/microsoft.graph.user?$select=${USER_FIELDS}&$top=999`;
  return graphGetAll(token, url);
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  // Kun autentificerede brugere (SWA sørger for dette, men dobbelt check)
  const principal = req.headers["x-ms-client-principal"];
  if (!principal) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  // Tjek portal_admin rolle
  let cp;
  try {
    cp = JSON.parse(Buffer.from(principal, "base64").toString("utf8"));
  } catch {
    return json(context, 401, { error: "Ugyldig principal" });
  }

  const userRoles = (cp.userRoles || []).map(r => String(r).toLowerCase());
  const claimRoles = (cp.claims || [])
    .filter(c => {
      const t = String(c.typ || "").toLowerCase();
      return t === "roles" || t === "role" || t.endsWith("/identity/claims/role");
    })
    .map(c => String(c.val || "").toLowerCase());

  const allRoles = new Set([...userRoles, ...claimRoles]);
  if (!allRoles.has("portal_admin")) {
    return json(context, 403, { error: "Adgang nægtet – kræver portal_admin" });
  }

  try {
    const token = await getGraphToken();
    const groupId = await findGroupId(token, GROUP_NAME);
    const members = await getGroupMembers(token, groupId);

    // Sorter alfabetisk på displayName
    members.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "da"));

    return json(context, 200, members);
  } catch (e) {
    context.log("entra-users ERROR:", e.message);
    return json(context, 500, { error: e.message });
  }
};
