// /api/news-admin – opret, ret og slet nyheder/tips/referater.
// Kræver portal_hp_nyheder eller portal_admin.
//   GET    /api/news-admin         → alle (også inaktive)
//   GET    /api/news-admin/{id}    → én med hele teksten
//   POST   /api/news-admin         → opret
//   PUT    /api/news-admin/{id}    → ret
//   DELETE /api/news-admin/{id}    → slet (inkl. billeder)
const N = require("../_news");
const { T } = N;
const { cleanHtml, syncImages } = N;

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

function buildPayload(b, user) {
  const type = String(b.type || "").toLowerCase();
  if (!(type in N.VALG)) throw bad("Ukendt type");
  const overskrift = String(b.overskrift || "").trim();
  const indhold = String(b.indhold || "").trim();
  if (!overskrift) throw bad("Overskrift må ikke være tom");
  if (!indhold) throw bad("Kort besked må ikke være tom");

  const banner = b.banner || {};
  const bannertekst = String(banner.tekst || "").trim().slice(0, 30);
  const vis = String(banner.visning || "alle").toLowerCase();
  if (!["mig", "test", "alle"].includes(vis)) throw bad("Ukendt visning for bjælken");
  const visning = vis === "mig" ? `mig:${String(user?.email || "").toLowerCase()}` : vis;

  return {
    [T.valg]: N.VALG[type],
    [T.overskrift]: overskrift,
    [T.indhold]: indhold,
    [T.brodtekst]: cleanHtml(b.brodtekst),
    [T.videourl]: String(b.videourl || "").trim() || null,
    [T.aktiv]: (b.status && N.STATUS_TEXT[b.status]) ? N.STATUS_TEXT[b.status] : (b.aktiv === false ? "Nej" : "Ja"),
    [T.udlobsdato]: normDate(b.udlobsdato),
    [T.bannertekst]: bannertekst || null,
    [T.bannercolor]: normColor(banner.farve),
    [T.bannerTile]: !!(bannertekst && banner.tile),
    [T.bannerNavbar]: !!(bannertekst && banner.navbar),
    [T.bannerSlut]: normDateTime(banner.slut),
    [T.bannerVisning]: visning
  };
}

module.exports = async function (context, req) {
  const user = await N.requireEditor(context, req);
  if (!user) return;

  const method = (req.method || "GET").toUpperCase();
  const id = String(context.bindingData?.id || req.query?.id || "").trim();
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return N.json(context, 400, { error: "Ugyldigt id" });

  try {
    if (method === "GET") {
      // Let kald til forsiden: antal nyheder der venter på godkendelse
      if (String(req.query?.count || "") === "pending") {
        const data = await N.dv(`${N.TIP_SET}?$select=${N.TIP_ID}&$filter=${T.aktiv} eq 'Afventer'`);
        return N.json(context, 200, { pending: (data?.value || []).length });
      }
      const select = [...N.LIST_COLS, T.brodtekst].join(",");
      if (id) {
        const row = await N.dv(`${N.TIP_SET}(${id})?$select=${select}`);
        return N.json(context, 200, { item: N.mapRow(row, { withBody: true }) });
      }
      const data = await N.dv(`${N.TIP_SET}?$select=${select}&$orderby=createdon desc`);
      return N.json(context, 200, { items: (data?.value || []).map(r => N.mapRow(r)) });
    }

    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const payload = buildPayload(req.body || {}, user);
      if (payload[T.videourl]) payload[T.videourl] = (await N.resolveVideoLink(payload[T.videourl])).embed || null;
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
