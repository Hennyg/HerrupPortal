// /api/track/index.js

const { dvFetch } = require("../_dataverse");

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

function pickEmail(cp) {
  if (!cp) return "";

  const claims = Array.isArray(cp.claims) ? cp.claims : [];

  const getClaim = (t) => claims.find(c => c.typ === t)?.val;

  return (
    getClaim("preferred_username") ||
    getClaim("upn") ||
    cp.userDetails ||
    ""
  );
}

module.exports = async function (context, req) {
  try {
    const cp = getClientPrincipal(req);
    const userEmail = pickEmail(cp);

    const body = req.body || {};

    const pageUrl = String(body.pageUrl || "").substring(0, 1000);
    const path = String(body.path || "").substring(0, 300);
    const referrer = String(body.referrer || "").substring(0, 1000);

    let queryString = "";
    try {
      const u = new URL(pageUrl);
      queryString = (u.search || "").substring(0, 1000);
    } catch { }

    const clientIp =
      (req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim()
        .substring(0, 100);

    const userAgent =
      String(req.headers["user-agent"] || "").substring(0, 500);

    const timestampUtc = new Date().toISOString();

    // 🔵 Opret række i Dataverse
    await dvFetch("POST", "cr175_lch_accesslogs", {
      cr175_lch_UserEmail: userEmail,
      cr175_lch_timestamputc: timestampUtc,
      cr175_lch_url: pageUrl,
      cr175_lch_path: path,
      cr175_lch_queryString: queryString,
      cr175_lch_referrer: referrer,
      cr175_lch_clientIp: clientIp,
      cr175_lch_useragent: userAgent
    });

    return json(context, 200, { ok: true });

  } catch (e) {
    context.log("TRACK ERROR", e);
    return json(context, 500, { error: "track_failed" });
  }
};
