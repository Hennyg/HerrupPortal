// /api/tips/index.js
// Aktive nyheder/tips til "Velkommen"-tile'n på forsiden + aktive bannere
// (gul bjælke i tile'n og/eller under navbaren).
const N = require("../_news");
const { T } = N;

module.exports = async function (context) {
  try {
    const now = new Date();
    const select = [...N.LIST_COLS, T.brodtekst].join(",");
    const data = await N.dv(`${N.TIP_SET}?$select=${select}&$orderby=createdon desc`);
    const rows = (data?.value || []).filter(r => N.yes(r[T.aktiv]));

    const items = rows
      .filter(r => r[T.valg] === N.VALG.tip || N.frontpageActive(r, now))
      .map(r => N.mapRow(r));

    const banners = rows
      .filter(r => N.bannerActive(r, now))
      .map(r => {
        const m = N.mapRow(r);
        return { id: m.id, overskrift: m.overskrift, indhold: m.indhold, hasBody: m.hasBody || !!m.videourl, ...m.banner };
      });

    return N.json(context, 200, { items, banners });
  } catch (e) {
    context.log("tips ERROR:", e.message);
    // Forsiden må ikke vælte pga. banneret – fejlen kan ses i Network.
    return N.json(context, 200, { items: [], banners: [], error: e.message });
  }
};
