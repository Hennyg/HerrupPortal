const fetch = globalThis.fetch;

function formUrlEncoded(obj){
  return Object.entries(obj).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

async function getToken() {
  const tenant = process.env.DV_TENANT_ID;
  const clientId = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;
  const resource = process.env.DV_URL;

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const body = formUrlEncoded({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: `${resource}/.default`
  });

  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const j = await r.json();
  if (!r.ok) throw new Error(`token_error: ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

async function dvFetch(path, { method="GET", body=null, headers={} } = {}) {
  const token = await getToken();
  const url = `${process.env.DV_URL}/api/data/v9.2/${path.replace(/^\//,"")}`;

  const r = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
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

module.exports = { dvFetch };
