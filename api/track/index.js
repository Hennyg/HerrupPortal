// /api/track/index.js

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body
  };
}

function getClientPrincipal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;

  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function pickUser(cp) {
  if (!cp) return { isAuthenticated: false };

  // cp.userDetails er ofte e-mail / UPN
  const userDetails = cp.userDetails || "";
  const claims = Array.isArray(cp.claims) ? cp.claims : [];

  const getClaim = (t) => claims.find(c => c.typ === t)?.val;

  return {
    isAuthenticated: true,
    userDetails,
    name: getClaim("name") || "",
    email:
      getClaim("preferred_username") ||
      getClaim("upn") ||
      userDetails ||
      "",
    oid: getClaim("http://schemas.microsoft.com/identity/claims/objectidentifier") || getClaim("oid") || "",
    tid: getClaim("http://schemas.microsoft.com/identity/claims/tenantid") || getClaim("tid") || ""
  };
}

module.exports = async function (context, req) {
  try {
    const cp = getClientPrincipal(req);
    const user = pickUser(cp);

    // Hvis du vil kræve login for tracking:
    // if (!user.isAuthenticated) return json(context, 401, { error: "not_authenticated" });

    const b = req.body || {};
    const entry = {
      eventType: String(b.eventType || "Unknown").substring(0, 50),
      pageUrl: String(b.pageUrl || "").substring(0, 1000),
      path: String(b.path || "").substring(0, 300),
      referrer: String(b.referrer || "").substring(0, 1000),
      tsLocal: String(b.tsLocal || ""),
      tsUtc: new Date().toISOString(),

      // user info
      userEmail: String(user.email || "").substring(0, 200),
      userName: String(user.name || "").substring(0, 200),
      userOid: String(user.oid || "").substring(0, 100),
      tenantId: String(user.tid || "").substring(0, 100),

      // valgfrit (GDPR-vurdering): IP og UA
      // clientIp: (req.headers["x-forwarded-for"] || "").split(",")[0].trim(),
      userAgent: String(req.headers["user-agent"] || "").substring(0, 300)
    };

    // TODO: Gem i Dataverse / App Insights / Storage
    // Lige nu: log til function logs (kan bruges midlertidigt)
    context.log("TRACK:", entry);

    return json(context, 200, { ok: true });
  } catch (e) {
    context.log("track error", e);
    return json(context, 500, { error: "track_failed" });
  }
};
