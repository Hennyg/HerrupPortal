// /api/simulate-roles?initialer=pks
// Slår en brugers app-roller op, så forsiden kan vises som den bruger.
// Kun for portal_admin. Bruges af ?visSom=<initialer> i assets/app.js.
const N = require("../_news");

module.exports = async function (context, req) {
  const me = N.getPrincipal(req);
  if (!me) return N.json(context, 401, { error: "Ikke logget ind" });

  try {
    me.roles = await N.lookupRoles(me);
  } catch (e) {
    return N.json(context, 500, { error: `Kunne ikke slå dine roller op: ${e.message}` });
  }
  if (!me.roles.includes("portal_admin")) {
    return N.json(context, 403, { error: "Kun portal_admin kan simulere andre brugere" });
  }

  // Initialer ("pks") eller hel mailadresse ("pks@lcherrup.dk")
  const input = String(req.query?.initialer || "").trim().toLowerCase();
  const upn = input.includes("@") ? input : `${input}@lcherrup.dk`;
  if (!/^[a-z0-9._-]{1,40}@[a-z0-9.-]+\.[a-z]{2,}$/.test(upn)) {
    return N.json(context, 400, { error: "Ugyldige initialer" });
  }

  try {
    const token = await N.graphToken();
    const filter = encodeURIComponent(`userPrincipalName eq '${upn}' or mail eq '${upn}'`);
    const res = await N.graphJson(token, `users?$filter=${filter}&$select=id,displayName,userPrincipalName,mail`);
    const user = (res.value || [])[0];
    if (!user) return N.json(context, 404, { error: `Ingen bruger med ${upn}` });

    const roles = await N.lookupRoles({ userId: user.id, roles: [] });
    return N.json(context, 200, {
      user: { displayName: user.displayName || "", upn: user.userPrincipalName || upn },
      roles
    });
  } catch (e) {
    context.log.error("simulate-roles:", e);
    return N.json(context, 500, { error: e.message });
  }
};
