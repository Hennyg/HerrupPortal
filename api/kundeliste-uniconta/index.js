// api/kundeliste-uniconta/index.js
// GET /api/kundeliste-uniconta            → { kunder: [{ kundenr, konto, navn, distrikt, iKundeliste }], ms }
//   iKundeliste = kundenr. findes i kundelisten (uanset aktiv/inaktiv)
// GET /api/kundeliste-uniconta?kundenr=…  → { kunde: {…} | null }
// Uniconta-debitorer til søgning i kundelisten og til kemi-rabat. Caches 15 min.

const N = require("../_news");
const U = require("../_unicontaKunder");
const R = require("../_rabat");          // kundeMap: alle kundenumre i kundelisten

module.exports = async function (context, req) {
  if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });
  try {
    const nr = String(req.query.kundenr || "").trim();
    if (nr) return N.json(context, 200, { kunde: await U.unicontaKunde(nr) });
    const t0 = Date.now();
    const [uni, km] = await Promise.all([U.unicontaKunder(), R.kundeMap().catch(() => new Map())]);
    const kunder = uni.map(u => ({ ...u, iKundeliste: km.has(u.kundenr) }));
    return N.json(context, 200, { kunder, ms: Date.now() - t0 });
  } catch (e) {
    context.log("kundeliste-uniconta ERROR:", e.message);
    return N.json(context, 502, { error: e.message, kunder: [] });
  }
};
