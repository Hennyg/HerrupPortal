// /api/tips/index.js
// Aktive nyheder/tips til "Velkommen"-tile'n på forsiden + aktive bannere
// (gul bjælke i tile'n og/eller under navbaren).
const N = require("../_news");
const M = require("../_medarbejder");
const { T } = N;

module.exports = async function (context, req) {
  try {
    const now = new Date();
    const select = [...N.LIST_COLS, T.brodtekst].join(",");
    const data = await N.dv(`${N.TIP_SET}?$select=${select}&$orderby=createdon desc`);
    const rows = (data?.value || []).filter(r => N.yes(r[T.aktiv]) && !N.isExpired(r, now));

    // Nyheder kan være begrænset til "mig" eller "test" – gælder også bjælken
    const canSee = N.viewerFilter(req);
    const visible = [];
    for (const r of rows) {
      const m = N.mapRow(r);
      if (await canSee(m)) visible.push({ r, m });
    }

    const items = visible
      .filter(({ r }) => r[T.valg] === N.VALG.tip || N.frontpageActive(r, now))
      .map(({ m }) => N.publicItem(m));

    // Fødselsdage (i dag – og på en fredag også weekendens) vises først.
    // Fejl her må ikke stoppe nyhederne.
    let birthdays = [];
    try {
      birthdays = await M.birthdayItems(now);
    } catch (e) {
      context.log("tips: fødselsdage fejlede:", e.message);
    }

    const banners = visible
      .filter(({ r }) => N.bannerActive(r, now))
      .map(({ m }) => ({
        id: m.id, overskrift: m.overskrift, indhold: m.indhold,
        hasBody: m.hasBody || !!m.videourl, modifiedon: m.modifiedon, ...m.banner
      }));

    return N.json(context, 200, { items: [...birthdays, ...items], banners });
  } catch (e) {
    context.log("tips ERROR:", e.message);
    // Forsiden må ikke vælte pga. banneret – fejlen kan ses i Network.
    return N.json(context, 200, { items: [], banners: [], error: e.message });
  }
};



