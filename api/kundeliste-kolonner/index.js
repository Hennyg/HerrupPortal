// api/kundeliste-kolonner/index.js
// GET /api/kundeliste-kolonner
// → { afdeling, gruppeId, grupper: [{ id, navn, kolonner, standard }] }
//
// Bruges af kundelisten: brugerens afdeling (Entra "department") slås op, og
// den kolonnegruppe, afdelingen står i, vælges. Står afdelingen ikke i nogen
// gruppe, bruges standardgruppen. Ingen grupper → gruppeId = null (alle
// standardkolonner). Grupperne caches i 2 min.

const N = require("../_news");
const A = require("../_kundelisteAdmin");

let cache = { at: 0, grupper: null };

module.exports = async function (context, req) {
  const me = N.getPrincipal(req);
  if (!me) return N.json(context, 401, { error: "Ikke logget ind" });

  try {
    if (!cache.grupper || Date.now() - cache.at > 2 * 60 * 1000) {
      cache = { at: Date.now(), grupper: await A.listGrupper() };
    }
    const grupper = cache.grupper;
    const afdeling = await A.userDepartment(me.userId);
    const gruppe = A.gruppeForAfdeling(grupper, afdeling);

    return N.json(context, 200, {
      afdeling,
      gruppeId: gruppe?.id || null,
      grupper: grupper.map(g => ({ id: g.id, navn: g.navn, kolonner: g.kolonner, standard: g.standard }))
    });
  } catch (e) {
    context.log("kundeliste-kolonner ERROR:", e.message);
    // Uden grupper kan listen stadig vises med standardkolonnerne
    return N.json(context, 200, { afdeling: "", gruppeId: null, grupper: [], error: e.message });
  }
};
