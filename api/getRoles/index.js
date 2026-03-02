module.exports = async function (context, req) {
  const principalB64 = req.headers["x-ms-client-principal"];

  // Ikke logget ind → ingen custom roles
  if (!principalB64) {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: []
    };
    return;
  }

  const cp = JSON.parse(Buffer.from(principalB64, "base64").toString("utf8"));

  // Roles kan ligge både i userRoles og i claims (typ: "roles")
  const rolesFromUserRoles = (cp.userRoles || []).map(r => String(r).toLowerCase());
  const rolesFromClaims = (cp.claims || [])
    .filter(c => String(c.typ).toLowerCase() === "roles")
    .map(c => String(c.val).toLowerCase());

  // Sammensæt + dedup + drop standardroller
  const set = new Set([...rolesFromUserRoles, ...rolesFromClaims]);
  set.delete("anonymous");
  set.delete("authenticated");

  // Hierarki: admin => user (hvis du vil)
  if (set.has("portal_admin")) set.add("portal_user");

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: [...set]
  };
};
