// api/entra-user/index.js
// Henter ÉN medarbejder beriget med foto + manager + evt. brugerdefineret billede.
// Bruges til direkte-link fra søgning på index-siden, så vi ikke skal vente på
// hele /api/entra-users, som beriger ALLE medarbejdere i gruppen.
const fetch = globalThis.fetch;

const GROUP_NAME = "Alle - lely center herrup";

const USER_FIELDS = [
  "id", "displayName", "mail", "userPrincipalName",
  "jobTitle", "department", "mobilePhone", "businessPhones", "officeLocation", "accountEnabled"
].join(",");

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

// Sikkerhedstjek: sørg for at det id der bliver spurgt om faktisk er medlem
// af "Alle"-gruppen, så endpointet ikke kan bruges til at slå ALLE tenant-
// brugere op via et gættet id.
async function isGroupMember(token, userId, groupId) {
  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/checkMemberGroups`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: [groupId] })
      }
    );
    const j = await r.json();
    if (!r.ok) return false;
    return Array.isArray(j.value) && j.value.includes(groupId);
  } catch {
    return false;
  }
}

async function getPhoto(token, userId) {
  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/photos/240x240/$value`,
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

async function getDataverseToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;
  const dvUrl        = process.env.DV_COREDATA;

  if (!tenant || !clientId || !clientSecret || !dvUrl) return null;

  try {
    const r = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "client_credentials",
          client_id:     clientId,
          client_secret: clientSecret,
          scope:         `${dvUrl}/.default`
        })
      }
    );
    const j = await r.json();
    if (!r.ok) return null;
    return j.access_token;
  } catch {
    return null;
  }
}

// Henter evt. brugerdefineret billede for ÉN medarbejder ud fra mail.
async function getCustomPhoto(mail) {
  const dvUrl = process.env.DV_COREDATA;
  if (!dvUrl || !mail) return null;

  try {
    const token = await getDataverseToken();
    if (!token) return null;

    const filter = encodeURIComponent(`cr1eb_lch_mail eq '${mail.replace(/'/g, "''")}'`);
    const url = `${dvUrl}/api/data/v9.2/cr1eb_lch_medarbejderes?$select=cr1eb_lch_mail,cr1eb_lch_foto&$filter=${filter}&$top=1`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json"
      }
    });
    const j = await r.json();
    if (!r.ok) return null;
    return j.value?.[0]?.cr1eb_lch_foto || null;
  } catch {
    return null;
  }
}

module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  const id = (req.query.id || "").trim();
  if (!id) {
    return json(context, 400, { error: "Mangler id" });
  }

  try {
    const token   = await getGraphToken();
    const groupId = await findGroupId(token, GROUP_NAME);

    const member = await isGroupMember(token, id, groupId);
    if (!member) {
      return json(context, 404, { error: "Medarbejder ikke fundet" });
    }

    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(id)}?$select=${USER_FIELDS}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const user = await r.json();
    if (!r.ok) throw new Error(user.error?.message || `graph_error ${r.status}`);

    const [photo, manager] = await Promise.all([
      getPhoto(token, user.id),
      getManager(token, user.id)
    ]);

    const enriched = {
      ...user,
      photo,
      managerId: manager?.id || null,
      managerName: manager?.displayName || null
    };

    const mail = String(user.mail || user.userPrincipalName || "").toLowerCase().trim();
    const custom = mail ? await getCustomPhoto(mail) : null;
    enriched.entraPhoto = enriched.photo;
    enriched.hasCustomPhoto = !!custom;
    if (custom) enriched.photo = custom;

    return json(context, 200, enriched);
  } catch (e) {
    context.log("entra-user ERROR:", e.message);
    return json(context, 500, { error: e.message });
  }
};
