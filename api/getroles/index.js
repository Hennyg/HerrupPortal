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
