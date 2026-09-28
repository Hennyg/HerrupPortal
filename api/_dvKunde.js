// api/_dvKunde.js
const fetch = globalThis.fetch;

function formUrlEncoded(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// Kundeliste-data ligger i et andet Dataverse-miljø (cr1eb_) end portalen (cr175_).
// Samme app registration (DV_*) bruges, kun miljø-URL'en er separat (KL_DV_URL).
function dvUrl() {
  return String(process.env.KL_DV_URL || "").replace(/\/+$/, "");
}

async function getToken() {
  const tenant = process.env.DV_TENANT_ID;
  const clientId = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;
  const resource = dvUrl();

  if (!tenant || !clientId || !clientSecret || !resource) {
    throw new Error("Manglende KL_DV_URL, DV_TENANT_ID, DV_CLIENT_ID eller DV_CLIENT_SECRET");
  }

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formUrlEncoded({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: `${resource}/.default`
    })
  });

  const j = await r.json();
  if (!r.ok) throw new Error(`token_error ${r.status}: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function dvFetch(path, { method = "GET", body = null, headers = {} } = {}) {
  const token = await getToken();
  const url = `${dvUrl()}/api/data/v9.2/${path.replace(/^\//, "")}`;

  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }

  if (!r.ok) {
    const msg = data?.error?.message || data?.message || txt;
    const e = new Error(`dv_error ${r.status}: ${msg}`);
    e.status = r.status;
    e.data = data;
    throw e;
  }

  return data;
}

async function fetchAll(path) {
  const baseUrl = `${dvUrl()}/api/data/v9.2/`;
  let rows = [];
  let next = path;
  while (next) {
    const data = await dvFetch(next);
    rows = rows.concat(data.value || []);
    const nl = data["@odata.nextLink"];
    next = nl && nl.startsWith(baseUrl) ? nl.slice(baseUrl.length) : null;
  }
  return rows;
}

module.exports = { dvFetch, fetchAll };
