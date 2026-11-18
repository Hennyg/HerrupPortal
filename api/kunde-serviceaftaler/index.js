// api/kunde-serviceaftaler/index.js
// GET /api/kunde-serviceaftaler → { items: [{ kundenr, varenr, servicetype, afdeling, startdato, enddato, note }] }
// Alle serviceaftaler (lch_serviceaftaler + aftaletekst) til kundelistens
// serviceaftale-kolonner. Kan læses af alle indloggede; oprettelse sker via
// /api/kundeliste-admin (kun admin). Caches 1 min.

const N = require("../_news");
const A = require("../_kundelisteAdmin");

let cache = { at: 0, items: null };

module.exports = async function (context, req) {
  if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });
  try {
    if (!cache.items || Date.now() - cache.at > 60 * 1000) {
      const items = (await A.listServiceaftaler()).map(({ id, ...rest }) => rest);
      cache = { at: Date.now(), items };
    }
    return N.json(context, 200, { items: cache.items });
  } catch (e) {
    context.log("kunde-serviceaftaler ERROR:", e.message);
    return N.json(context, 500, { error: e.message, items: [] });
  }
};
