module.exports = async function (context, req) {
  const principalB64 = req.headers["x-ms-client-principal"];

  if (!principalB64) {
    context.res = { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: [] };
    return;
  }

  let cp;
  try {
    cp = JSON.parse(Buffer.from(principalB64, "base64").toString("utf8"));
  } catch {
    context.res = { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: [] };
    return;
  }

  // Roles kan ligge i claims (typ: "roles")
  const rolesFromClaims = (cp.claims || [])
    .filter(c => String(c.typ || "").toLowerCase() === "roles")
    .map(c => String(c.val || "").toLowerCase());

  // (evt) også fra userRoles hvis der er noget der
  const rolesFromUserRoles = (cp.userRoles || []).map(r => String(r).toLowerCase());

  const set = new Set([...rolesFromUserRoles, ...rolesFromClaims]);
  set.delete("anonymous");
  set.delete("authenticated");

  // Admin override hvis du vil:
  // if (set.has("portal_admin")) set.add("portal_user");

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: [...set]
  };
};
