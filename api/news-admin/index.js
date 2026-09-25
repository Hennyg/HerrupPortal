// /api/news-admin – opret, ret og slet nyheder/tips/referater.
// Kræver portal_hp_nyheder eller portal_admin.
//   GET    /api/news-admin         → alle (også inaktive)
//   GET    /api/news-admin/{id}    → én med hele teksten
//   POST   /api/news-admin         → opret
//   PUT    /api/news-admin/{id}    → ret
//   DELETE /api/news-admin/{id}    → slet (inkl. billeder)
const N = require("../_news");
const { T, I } = N;

const IMG_REF = /\/api\/news-image\/([0-9a-f-]{36})/gi;
const bad = msg => Object.assign(new Error(msg), { userError: true });

function normDate(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad("Ugyldig dato");
  return s;
}
function normDateTime(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw bad("Ugyldigt tidspunkt for banner-slut");
  return d.toISOString();
}
function normColor(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (!/^#[0-9a-f]{6}$/i.test(s)) throw bad("Farve skal være en hex-kode, fx #FFD400");
  return s.toUpperCase();
}

// Fjerner scripts, event-attributter og javascript:-links. Visningen renser
// også med DOMPurify, så dette er et ekstra lag.
function cleanHtml(html) {
  return String(html || "")
    .replace(/<\s*(script|style|iframe|object|embed|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|meta|link)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

function buildPayload(b) {
  const type = String(b.type || "").toLowerCase();
  if (!(type in N.VALG)) throw bad("Ukendt type");
  const overskrift = String(b.overskrift || "").trim();
  const indhold = String(b.indhold || "").trim();
  if (!overskrift) throw bad("Overskrift må ikke være tom");
  if (!indhold) throw bad("Kort besked må ikke være tom");

  const banner = b.banner || {};
  const bannertekst = String(banner.tekst || "").trim().slice(0, 30);

  return {
    [T.valg]: N.VALG[type],
    [T.overskrift]: overskrift,
    [T.indhold]: indhold,
    [T.brodtekst]: cleanHtml(b.brodtekst),
    [T.videourl]: String(b.videourl || "").trim() || null,
    [T.aktiv]: b.aktiv === false ? "Nej" : "Ja",
    [T.udlobsdato]: normDate(b.udlobsdato),
    [T.bannertekst]: bannertekst || null,
    [T.bannercolor]: normColor(banner.farve),
    [T.bannerTile]: !!(bannertekst && banner.tile),
    [T.bannerNavbar]: !!(bannertekst && banner.navbar),
    [T.bannerSlut]: normDateTime(banner.slut)
  };
}

// Knyt billeder i teksten til nyheden, og slet dem der ikke længere bruges.
async function syncImages(tipId, html) {
  const { entitySet, navProp } = await N.imageMeta();
  const used = new Set([...String(html || "").matchAll(IMG_REF)].map(m => m[1].toLowerCase()));

  const linked = await N.dv(`${entitySet}?$select=${N.IMG_ID}&$filter=${I.tipValue} eq ${tipId}`);
  const linkedIds = new Set((linked?.value || []).map(r => String(r[N.IMG_ID]).toLowerCase()));

  for (const id of used) {
    if (linkedIds.has(id)) continue;
    try {
      await N.dv(`${entitySet}(${id})`, { method: "PATCH", body: { [`${navProp}@odata.bind`]: `/${N.TIP_SET}(${tipId})` } });
    } catch { /* billedet findes ikke længere */ }
  }
  for (const id of linkedIds) {
    if (!used.has(id)) {
      try { await N.dv(`${entitySet}(${id})`, { method: "DELETE" }); } catch { /* ignoreres */ }
    }
  }

  // Oprydning: billeder uploadet men aldrig gemt i en nyhed (ældre end 2 dage)
  try {
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString();
    const orphans = await N.dv(`${entitySet}?$select=${N.IMG_ID}&$filter=${I.tipValue} eq null and createdon lt ${cutoff}&$top=50`);
    for (const r of orphans?.value || []) {
      try { await N.dv(`${entitySet}(${r[N.IMG_ID]})`, { method: "DELETE" }); } catch { /* ignoreres */ }
    }
  } catch { /* ignoreres */ }
}

module.exports = async function (context, req) {
  const user = await N.requireEditor(context, req);
  if (!user) return;

  const method = (req.method || "GET").toUpperCase();
  const id = String(context.bindingData?.id || req.query?.id || "").trim();
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return N.json(context, 400, { error: "Ugyldigt id" });

  try {
    if (method === "GET") {
      const select = [...N.LIST_COLS, T.brodtekst].join(",");
      if (id) {
        const row = await N.dv(`${N.TIP_SET}(${id})?$select=${select}`);
        return N.json(context, 200, { item: N.mapRow(row, { withBody: true }) });
      }
      const data = await N.dv(`${N.TIP_SET}?$select=${select}&$orderby=createdon desc`);
      return N.json(context, 200, { items: (data?.value || []).map(r => N.mapRow(r)) });
    }

    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const payload = buildPayload(req.body || {});
      let tipId = id;
      if (method === "POST") {
        const res = await N.dv(N.TIP_SET, { method: "POST", body: payload });
        tipId = res?.id;
      } else {
        if (!id) return N.json(context, 400, { error: "Mangler id" });
        await N.dv(`${N.TIP_SET}(${id})`, { method: "PATCH", body: payload });
      }
      let imageWarning = null;
      if (tipId) {
        try { await syncImages(tipId, payload[T.brodtekst]); }
        catch (e) { imageWarning = `Billeder kunne ikke knyttes til nyheden: ${e.message}`; }
      }
      return N.json(context, 200, { ok: true, id: tipId, imageWarning });
    }

    if (method === "DELETE") {
      if (!id) return N.json(context, 400, { error: "Mangler id" });
      try { await syncImages(id, ""); } catch { /* billeder slettes så vidt muligt */ }
      await N.dv(`${N.TIP_SET}(${id})`, { method: "DELETE" });
      return N.json(context, 200, { ok: true });
    }

    return N.json(context, 405, { error: "Metode ikke tilladt" });
  } catch (e) {
    if (e.userError) return N.json(context, 400, { error: e.message });
    context.log.error("news-admin:", e);
    return N.json(context, 500, { error: e.message });
  }
};
