// /api/news            → alle aktive nyheder/tips/referater (nyeste først)
// /api/news/{id}       → én nyhed med hele teksten
const N = require("../_news");
const { T } = N;

module.exports = async function (context, req) {
  if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });
  try {
    const id = String(context.bindingData?.id || "").trim();

    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return N.json(context, 400, { error: "Ugyldigt id" });
      const select = [...N.LIST_COLS, T.brodtekst].join(",");
      let row;
      try {
        row = await N.dv(`${N.TIP_SET}(${id})?$select=${select}`);
      } catch (e) {
        if (e.status === 404) return N.json(context, 404, { error: "Nyheden findes ikke" });
        throw e;
      }
      if (!N.yes(row[T.aktiv])) return N.json(context, 404, { error: "Nyheden er ikke aktiv" });
      const item = N.mapRow(row, { withBody: true });
      if (!(await N.viewerFilter(req)(item))) return N.json(context, 404, { error: "Nyheden findes ikke" });
      return N.json(context, 200, { item: N.publicItem(item) });
    }

    const select = [...N.LIST_COLS, T.brodtekst].join(",");
    const data = await N.dv(`${N.TIP_SET}?$select=${select}&$orderby=createdon desc&$top=500`);
    const canSee = N.viewerFilter(req);
    const items = [];
    for (const r of (data?.value || []).filter(r => N.yes(r[T.aktiv]))) {
      const m = N.mapRow(r);
      if (await canSee(m)) items.push(N.publicItem(m));
    }
    return N.json(context, 200, { items });
  } catch (e) {
    context.log.error("news:", e);
    return N.json(context, 500, { error: e.message });
  }
};
