// api/entra-users-search/index.js
// Let søgning i "Alle - lely center herrup"-gruppen til brug for hurtig-søgning
// på index-siden. Bruges kun som fallback når browser-cachen (IndexedDB) er
// kold/forældet — henter derfor KUN basale felter, ingen foto/manager.
const fetch = globalThis.fetch;

const GROUP_NAME = "Alle - lely center herrup";
const SEARCH_FIELDS = "id,displayName,mail,jobTitle,department";

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

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

async function findGroupId(token, name) {
  const filter = encodeURIComponent(`displayName eq '${name}'`);
  const url = `https://graph.microsoft.com/v1.0/groups?$filter=${filter}&$select=id&$count=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `graph_error ${r.status}`);
  if (!j.value?.length) throw new Error(`Gruppe ikke fundet: "${name}"`);
  return j.value[0].id;
}

function escOData(s) {
  return String(s).replace(/'/g, "''");
}

module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  const q = (req.query.q || "").trim();
  if (q.length < 2) {
    return json(context, 200, []);
  }

  try {
    const token   = await getGraphToken();
    const groupId = await findGroupId(token, GROUP_NAME);

    const term = escOData(q);
    const filter = encodeURIComponent(
      `startswith(displayName,'${term}') or startswith(mail,'${term}') or startswith(userPrincipalName,'${term}')`
    );
    const url =
      `https://graph.microsoft.com/v1.0/groups/${groupId}/transitiveMembers/microsoft.graph.user` +
      `?$filter=${filter}&$select=${SEARCH_FIELDS}&$top=15&$count=true`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" }
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `graph_error ${r.status}`);

    const results = (j.value || [])
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "da"));

    return json(context, 200, results);
  } catch (e) {
    context.log("entra-users-search ERROR:", e.message);
    return json(context, 500, { error: e.message });
  }
};
