// api/_graphKunde.js
//
// Graph-token til opslag af kunde-gæstebrugere i Entra ID.
// Bruger KUNDE_CLIENT_ID/KUNDE_CLIENT_SECRET hvis de er sat (samme app
// registration som Kundeinfo-appen), ellers portalens DV_CLIENT_ID/DV_CLIENT_SECRET.
// App registration skal have Graph application permission User.Read.All.

let cached = null;

async function getGraphToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > now) return cached.token;

  const tenant = process.env.DV_TENANT_ID;
  const clientId = process.env.KUNDE_CLIENT_ID || process.env.DV_CLIENT_ID;
  const clientSecret = process.env.KUNDE_CLIENT_SECRET || process.env.DV_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Mangler DV_TENANT_ID, DV_CLIENT_ID eller DV_CLIENT_SECRET");
  }

  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default"
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`graph_token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);

  cached = { token: j.access_token, expiresAt: now + Number(j.expires_in || 3600) };
  return cached.token;
}

async function graphGet(path) {
  const token = await getGraphToken();
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) {
    const e = new Error(`graph_error ${r.status}: ${data?.error?.message || txt}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

module.exports = { graphGet };
