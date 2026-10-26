// /api/uniconta-adgang/index.js
// Returnerer de Uniconta-undersider, den aktuelle bruger har adgang til.
const A = require("../_unicontaAccess");

module.exports = async function (context, req) {
  const user = await A.requireUniconta(context, req);
  if (!user) return;
  return A.json(context, 200, {
    pages: user.pages.map(({ roles, ...p }) => p)
  });
};
