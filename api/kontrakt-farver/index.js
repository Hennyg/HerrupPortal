// api/kontrakt-farver/index.js
// GET /api/kontrakt-farver → { farver: { "<kontrakttype>": "#rrggbb" } }
// Bruges af kundelisten til baggrundsfarven i Kontrakt-kolonnen.
// Farverne styres på kundeliste_admin.html. Caches 2 min.

const N = require("../_news");
const A = require("../_kundelisteAdmin");

let cache = { at: 0, farver: null };

module.exports = async function (context, req) {
  if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });
  try {
    if (!cache.farver || Date.now() - cache.at > 2 * 60 * 1000) {
      const rows = await A.loadFarver();
      cache = { at: Date.now(), farver: Object.fromEntries(rows.filter(r => r.farve).map(r => [r.kontrakt, r.farve])) };
    }
    return N.json(context, 200, { farver: cache.farver });
  } catch (e) {
    context.log("kontrakt-farver ERROR:", e.message);
    // Uden farver kan listen stadig vises
    return N.json(context, 200, { farver: {}, error: e.message });
  }
};
