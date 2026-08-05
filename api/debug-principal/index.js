const fetch = globalThis.fetch;

async function getGraphToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;

  const r = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         "https://graph.microsoft.com/.default"
      })
    }
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`graph_token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

async function getAppServicePrincipal(graphToken) {
  const clientId = process.env.AZURE_CLIENT_ID;   // ← ændret fra DV_CLIENT_ID
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${clientId}'&$select=id,appId,appRoles`,
    { headers: { Authorization: `Bearer ${graphToken}` } }
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`graph_sp_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
  const sp = (j.value || [])[0];
  if (!sp) throw new Error("Service principal ikke fundet for AZURE_CLIENT_ID");
  return sp;
}

async function getUserAppRoles(graphToken, userId) {
  const sp = await getAppServicePrincipal(graphToken);
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/users/${userId}/appRoleAssignments`,
    { headers: { Authorization: `Bearer ${graphToken}` } }
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`graph_approles_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);

  const assigned = (j.value || []).filter(a => a.resourceId === sp.id);
  const roleIdToValue = new Map((sp.appRoles || []).map(r => [r.id, String(r.value || "")]));

  return {
    spAppRoles: sp.appRoles,
    assignedRaw: assigned,
    resolvedRoles: assigned.map(a => roleIdToValue.get(a.appRoleId) || `(ukendt id: ${a.appRoleId})`)
  };
}

module.exports = async function (context, req) {
  const principalB64 = req.headers["x-ms-client-principal"];
  if (!principalB64) {
    context.res = { status: 200, body: { error: "Ingen x-ms-client-principal header" } };
    return;
  }

  const principal = JSON.parse(Buffer.from(principalB64, "base64").toString("utf8"));
  const userId = principal.userId;

  try {
    const graphToken = await getGraphToken();
    const result = await getUserAppRoles(graphToken, userId);
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { userId, userDetails: principal.userDetails, ...result }
    };
  } catch (e) {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { error: e.message }
    };
  }
};
