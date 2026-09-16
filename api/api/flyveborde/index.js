// api/flyveborde/index.js
// Azure Function (Node.js 18+)
//
// Autoritativ liste over bookbare flyveborde:
//   Mail-enabled security group angivet i FlyvebordeGroupMail.
//
// Bookingstatus:
//   Dataverse-tabellen cr6da_alleflyvebordes.
//
// Et bord returneres kun, når:
//   1. Ressource-mailboksen er direkte medlem af adgangsgruppen.
//   2. Der findes en statusrække i Dataverse for den valgte dato.
//
// AMBy/PMBy/DayBy er nu inkluderet, så frontend kan vise "booket af" - kun
// udfyldt for det slot der reelt blev booket (se confirmbooking/
// bookdeskforother for logikken).

const TENANT_ID = process.env.TenantID;
const CLIENT_ID = process.env.ClientID;
const CLIENT_SECRET = process.env.ClientSecret;
const DATAVERSE_URL = String(process.env.DataverseUrl || "").replace(/\/$/, "");
const GROUP_MAIL = process.env.FlyvebordeGroupMail || "FlyvebordeAdgang@lcherrup.onmicrosoft.com";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const ENTITY_SET = "cr6da_alleflyvebordes";

module.exports = async function (context, req) {
  try {
    validateSettings();

    const deskRaw = String(req.query?.desk || "").trim();
    const dateRaw = String(req.query?.date || "").trim();
    const isIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw);

    const [graphToken, dataverseToken] = await Promise.all([
      getClientCredentialToken("https://graph.microsoft.com/.default"),
      getClientCredentialToken(`${DATAVERSE_URL}/.default`)
    ]);

    const group = await findAccessGroup(graphToken, GROUP_MAIL);
    const resources = await getResourceMembers(graphToken, group.id);

    if (resources.length === 0) {
      return json(context, 200, deskRaw ? { error: "No resources in access group" } : []);
    }

    let requestedResource = null;
    if (deskRaw) {
      requestedResource = findResource(resources, deskRaw);
      if (!requestedResource) {
        return json(context, 404, {
          error: "Not bookable",
          details: `Flyvebordet '${deskRaw}' er ikke medlem af ${GROUP_MAIL}.`
        });
      }
    }

    const rows = await getDataverseStatus(dataverseToken, {
      deskId: requestedResource?.deskId || "",
      date: isIsoDate ? dateRaw : ""
    });

    const resourcesByDesk = new Map(
      resources.map(resource => [normalizeKey(resource.deskId), resource])
    );

    const list = rows
      .map(row => {
        const resource = resourcesByDesk.get(normalizeKey(row.cr6da_deskid));
        if (!resource) return null;

        return {
          deskId: row.cr6da_deskid,
          resourceMail: resource.mail,
          resourceName: resource.displayName,
          description: resource.description,
          date: row.cr6da_date,
          lastUpdated: row.cr6da_lastupdated,
          AM: row.cr6da_am,
          PM: row.cr6da_pm,
          Day: row.cr6da_day,
          AMBy: row.cr6da_amby || "",
          PMBy: row.cr6da_pmby || "",
          DayBy: row.cr6da_dayby || ""
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.deskId).localeCompare(String(b.deskId), "da"));

    if (deskRaw) {
      if (list.length === 0) {
        return json(context, 404, {
          error: "Status not found",
          details: `Flyvebordet er i ${GROUP_MAIL}, men der findes ingen statusrække i Dataverse${isIsoDate ? ` for ${dateRaw}` : ""}.`,
          desk: deskRaw,
          date: isIsoDate ? dateRaw : undefined
        });
      }

      return json(context, 200, list[0]);
    }

    return json(context, 200, list);
  } catch (error) {
    context.log.error(error);
    return json(context, 500, {
      error: "Unhandled",
      details: error.message
    });
  }
};

function validateSettings() {
  const missing = [];
  if (!TENANT_ID) missing.push("TenantID");
  if (!CLIENT_ID) missing.push("ClientID");
  if (!CLIENT_SECRET) missing.push("ClientSecret");
  if (!DATAVERSE_URL) missing.push("DataverseUrl");
  if (!GROUP_MAIL) missing.push("FlyvebordeGroupMail");

  if (missing.length) {
    throw new Error(`Missing app settings: ${missing.join(", ")}`);
  }
}

async function getClientCredentialToken(scope) {
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(TENANT_ID)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        scope
      })
    }
  );

  const body = await readJsonOrText(response);
  if (!response.ok || !body?.access_token) {
    throw new Error(`Token error for ${scope}: ${formatBody(body)}`);
  }

  return body.access_token;
}

async function findAccessGroup(token, groupMail) {
  const escapedMail = groupMail.replace(/'/g, "''");
  const url =
    `${GRAPH_ROOT}/groups` +
    `?$select=id,displayName,mail,mailEnabled,securityEnabled` +
    `&$filter=${encodeURIComponent(`mail eq '${escapedMail}'`)}`;

  const response = await graphGet(token, url);
  const groups = Array.isArray(response.value) ? response.value : [];

  if (groups.length !== 1) {
    throw new Error(
      groups.length === 0
        ? `Adgangsgruppen '${groupMail}' blev ikke fundet i Microsoft Entra ID.`
        : `Flere grupper blev fundet med mailadressen '${groupMail}'.`
    );
  }

  const group = groups[0];
  if (group.mailEnabled !== true || group.securityEnabled !== true) {
    throw new Error(`'${groupMail}' er ikke en mail-enabled security group.`);
  }

  return group;
}

async function getResourceMembers(token, groupId) {
  let url =
    `${GRAPH_ROOT}/groups/${encodeURIComponent(groupId)}/members/microsoft.graph.user` +
    `?$select=id,displayName,mail,userPrincipalName,mailNickname,accountEnabled,state` +
    `&$top=999`;

  const members = [];
  while (url) {
    const page = await graphGet(token, url);
    if (Array.isArray(page.value)) members.push(...page.value);
    url = page["@odata.nextLink"] || "";
  }

  return members
    .map(member => {
      const mail = String(member.mail || member.userPrincipalName || "").trim();
      if (!mail || !mail.includes("@")) return null;

      return {
        id: member.id,
        displayName: String(member.displayName || mail).trim(),
        description: String(member.state || "").trim(),
        mail,
        deskId: mail.split("@")[0].trim()
      };
    })
    .filter(Boolean);
}

function findResource(resources, deskOrMail) {
  const key = normalizeKey(deskOrMail);
  return resources.find(resource =>
    normalizeKey(resource.deskId) === key || normalizeKey(resource.mail) === key
  );
}

async function getDataverseStatus(token, { deskId, date }) {
  let url =
    `${DATAVERSE_URL}/api/data/v9.2/${ENTITY_SET}` +
    `?$select=` +
    [
      "cr6da_deskid",
      "cr6da_am",
      "cr6da_amby",
      "cr6da_pm",
      "cr6da_pmby",
      "cr6da_day",
      "cr6da_dayby",
      "cr6da_date",
      "cr6da_lastupdated"
    ].join(",") +
    `&$orderby=cr6da_deskid asc,cr6da_date asc`;

  const filters = [];
  if (deskId) filters.push(`cr6da_deskid eq '${escapeOData(deskId)}'`);
  if (date) filters.push(`cr6da_date eq '${escapeOData(date)}'`);
  if (filters.length) url += `&$filter=${encodeURIComponent(filters.join(" and "))}`;

  const rows = [];
  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json;odata.metadata=none",
        Prefer: "odata.maxpagesize=5000"
      }
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new Error(`Dataverse fetch error: ${formatBody(body)}`);
    }

    if (Array.isArray(body.value)) rows.push(...body.value);
    url = body["@odata.nextLink"] || "";
  }

  return rows;
}

async function graphGet(token, url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  const body = await readJsonOrText(response);
  if (!response.ok) {
    throw new Error(`Microsoft Graph ${response.status}: ${formatBody(body)}`);
  }

  return body;
}

async function readJsonOrText(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatBody(body) {
  return typeof body === "string" ? body : JSON.stringify(body);
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeOData(value) {
  return String(value).replace(/'/g, "''");
}

function json(context, status, body) {
  context.res = {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body
  };
}
