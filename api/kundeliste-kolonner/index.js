// api/kundeliste-kolonner/index.js
// GET /api/kundeliste-kolonner
// → { afdeling, gruppeId, grupper: [{ id, navn, kolonner, standard }], hjaelp: { nøgle: tekst } }
//
// Bruges af kundelisten: brugerens afdeling (Entra "department") slås op, og
// den kolonnegruppe, afdelingen står i, vælges. Står afdelingen ikke i nogen
// gruppe, bruges standardgruppen. Ingen grupper → gruppeId = null (alle
// standardkolonner). Grupperne og hjælpeteksterne caches i 2 min.

const N = require("../_news");
const A = require("../_kundelisteAdmin");

let cache = { at: 0, grupper: null };
let hjCache = { at: 0, hjaelp: null };

// Hjælpetekster må ikke vælte kolonnegrupperne (fx hvis tabellen mangler)
async function getHjaelp(context) {
  if (hjCache.hjaelp && Date.now() - hjCache.at < 2 * 60 * 1000) return hjCache.hjaelp;
  try {
    hjCache = { at: Date.now(), hjaelp: await A.hjaelpMap() };
  } catch (e) {
    context.log("kundeliste-kolonner hjælpetekster:", e.message);
    hjCache = { at: Date.now(), hjaelp: {} };
  }
  return hjCache.hjaelp;
}

module.exports = async function (context, req) {
  const me = N.getPrincipal(req);
  if (!me) return N.json(context, 401, { error: "Ikke logget ind" });

  try {
    if (!cache.grupper || Date.now() - cache.at > 2 * 60 * 1000) {
      cache = { at: Date.now(), grupper: await A.listGrupper() };
    }
    const grupper = cache.grupper;
    const hjaelp = await getHjaelp(context);
    const afdeling = await A.userDepartment(me.userId);
    const gruppe = A.gruppeForAfdeling(grupper, afdeling);

    return N.json(context, 200, {
      afdeling,
      gruppeId: gruppe?.id || null,
      grupper: grupper.map(g => ({ id: g.id, navn: g.navn, kolonner: g.kolonner, standard: g.standard })),
      hjaelp
    });
  } catch (e) {
    context.log("kundeliste-kolonner ERROR:", e.message);
    // Uden grupper kan listen stadig vises med standardkolonnerne
    return N.json(context, 200, { afdeling: "", gruppeId: null, grupper: [], hjaelp: await getHjaelp(context), error: e.message });
  }
};
