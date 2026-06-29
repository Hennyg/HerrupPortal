// api/debug-principal/index.js
// MIDLERTIDIG – slet denne function når du har fejlsøgt færdig.
// Kalder du /api/debug-principal, returnerer den din fulde clientPrincipal
// inkl. alle claims og typer, så du kan se præcis hvad portal_admin-rollen hedder.

module.exports = async function (context, req) {
  const principalB64 = req.headers["x-ms-client-principal"];

  if (!principalB64) {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { loggedIn: false, message: "Ingen x-ms-client-principal header" }
    };
    return;
  }

  let principal;
  try {
    principal = JSON.parse(Buffer.from(principalB64, "base64").toString("utf8"));
  } catch (e) {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { error: "Parse fejl", details: e.message }
    };
    return;
  }

  // Udtræk de claims som kan indeholde roller
  const roleClaims = (principal.claims || []).filter(c => {
    const t = String(c.typ || "").toLowerCase();
    return t.includes("role") || c.val?.toLowerCase().includes("portal");
  });

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: {
      userDetails: principal.userDetails,
      identityProvider: principal.identityProvider,
      userRoles: principal.userRoles,
      roleClaims,               // kun role-relaterede claims
      allClaimTypes: (principal.claims || []).map(c => c.typ)  // alle claim-typer
    }
  };
};
