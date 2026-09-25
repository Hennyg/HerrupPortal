// /api/tips/index.js
// Aktive nyheder/tips til "Velkommen"-tile'n på forsiden + aktive bannere
// (gul bjælke i tile'n og/eller under navbaren).
const N = require("../_news");
const { T } = N;

module.exports = async function (context, req) {
  try {
    const now = new Date();
    const select = [...N.LIST_COLS, T.brodtekst].join(",");
    const data = await N.dv(`${N.TIP_SET}?$select=${select}&$orderby=createdon desc`);
    const rows = (data?.value || []).filter(r => N.yes(r[T.aktiv]));

    const items = rows
      .filter(r => r[T.valg] === N.VALG.tip || N.frontpageActive(r, now))
      .map(r => N.mapRow(r));

    // Bannere kan være begrænset til "mig" (den der gemte) eller "test"
    // (portal_admin + portal_hp_nyheder). Roller slås kun op i Graph, hvis
    // der faktisk findes et aktivt test-banner.
    const user = N.getPrincipal(req || { headers: {} });
    const email = String(user?.email || "").toLowerCase();
    let isTester = null;
    const canSee = async (b) => {
      if (b.visning === "alle") return true;
      if (b.visning === "mig") return !!email && b.ejer === email;
      if (b.visning === "test") {
        if (isTester === null) {
          try { isTester = user ? N.hasEditorRole(await N.lookupRoles(user)) : false; }
          catch { isTester = false; }
        }
        return isTester;
      }
      return false;
    };

    const banners = [];
    for (const r of rows.filter(r => N.bannerActive(r, now))) {
      const m = N.mapRow(r);
      if (!(await canSee(m.banner))) continue;
      const { ejer, ...banner } = m.banner;
      banners.push({ id: m.id, overskrift: m.overskrift, indhold: m.indhold, hasBody: m.hasBody || !!m.videourl, modifiedon: m.modifiedon, ...banner });
    }

    return N.json(context, 200, { items, banners });
  } catch (e) {
    context.log("tips ERROR:", e.message);
    // Forsiden må ikke vælte pga. banneret – fejlen kan ses i Network.
    return N.json(context, 200, { items: [], banners: [], error: e.message });
  }
};
