// api/kundeliste-admin/index.js
// /api/kundeliste-admin?action=...   (kun portal_admin / portal_kundeliste_admin)
//
//   GET    ?action=me                      → { admin }   (må kaldes af alle indloggede)
//   GET    ?action=kontrakter              → { items: [{ kontrakt, antal, farve }] }
//   POST   ?action=kontrakter              body { items: [{ kontrakt, farve }] }  (tom farve = standard)
//   GET    ?action=aftaletekster           → { items: [{ id, varenr, navn, servicetype, afdeling }] }
//   POST   ?action=aftaletekster           body { varenr, navn, servicetype, afdeling }
//   PATCH  ?action=aftaletekster&id=<guid> body { ...felter der ændres }
//   DELETE ?action=aftaletekster&id=<guid>
//   GET    ?action=serviceaftaler[&kundenr=<nr>] → { items: [...] }  (uden kundenr = alle)
//   POST   ?action=serviceaftaler          body { kundenr, aftaleId, startdato, enddato, note }
//   GET    ?action=kolonnegrupper          → { items: [{ id, navn, afdelinger, kolonner, standard }] }
//   POST   ?action=kolonnegrupper[&id=<guid>] body { navn, afdelinger, kolonner, standard }  (uden id = ny)
//   DELETE ?action=kolonnegrupper&id=<guid>
//   GET    ?action=afdelinger              → { items: [{ navn, antal }] }  (afdelinger i Entra)

const N = require("../_news");
const A = require("../_kundelisteAdmin");

module.exports = async function (context, req) {
  const action = String(req.query.action || "").toLowerCase();
  const method = String(req.method || "GET").toUpperCase();

  try {
    const { me, admin } = await A.isKundelisteAdmin(req);
    if (!me) return N.json(context, 401, { error: "Ikke logget ind" });

    if (action === "me") return N.json(context, 200, { admin });
    if (!admin) return N.json(context, 403, { error: "Kræver rollen portal_admin eller portal_kundeliste_admin" });

    // ── Kontraktfarver ──
    if (action === "kontrakter") {
      if (method === "GET") {
        const [antal, farver] = await Promise.all([A.kontraktTyper(), A.loadFarver()]);
        const byName = new Map(farver.map(f => [f.kontrakt.toLowerCase(), f]));
        const names = new Map();
        for (const k of antal.keys()) names.set(k.toLowerCase(), k);
        for (const f of farver) if (!names.has(f.kontrakt.toLowerCase())) names.set(f.kontrakt.toLowerCase(), f.kontrakt);
        const items = [...names.entries()].map(([key, kontrakt]) => ({
          kontrakt,
          antal: antal.get(kontrakt) || 0,
          farve: byName.get(key)?.farve || ""
        })).sort((a, b) => b.antal - a.antal || a.kontrakt.localeCompare(b.kontrakt, "da"));
        return N.json(context, 200, { items });
      }
      if (method === "POST") {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        if (!items.length) return N.json(context, 400, { error: "Ingen ændringer" });
        for (const it of items) await A.saveFarve(it.kontrakt, it.farve);
        return N.json(context, 200, { ok: true, saved: items.length });
      }
    }

    // ── Aftaletekster ──
    if (action === "aftaletekster") {
      const id = String(req.query.id || "");
      if (method === "GET")    return N.json(context, 200, { items: await A.listAftaler() });
      if (method === "POST")   return N.json(context, 200, { item: await A.createAftale(req.body || {}) });
      if (method === "PATCH")  { await A.updateAftale(id, req.body || {}); return N.json(context, 200, { ok: true }); }
      if (method === "DELETE") { await A.deleteAftale(id); return N.json(context, 200, { ok: true }); }
    }

    // ── Serviceaftaler ──
    if (action === "serviceaftaler") {
      if (method === "GET")  return N.json(context, 200, { items: await A.listServiceaftaler(req.query.kundenr) });
      if (method === "POST") return N.json(context, 200, await A.createServiceaftale(req.body || {}));
    }

    // ── Kolonnegrupper ──
    if (action === "kolonnegrupper") {
      const id = String(req.query.id || "");
      if (method === "GET")    return N.json(context, 200, { items: await A.listGrupper() });
      if (method === "POST")   return N.json(context, 200, await A.saveGruppe(req.body || {}, id || null));
      if (method === "DELETE") { await A.deleteGruppe(id); return N.json(context, 200, { ok: true }); }
    }
    if (action === "afdelinger" && method === "GET") {
      return N.json(context, 200, { items: await A.entraAfdelinger() });
    }

    return N.json(context, 400, { error: `Ukendt handling: ${method} ${action || "(ingen)"}` });
  } catch (e) {
    context.log("kundeliste-admin ERROR:", e.message);
    return N.json(context, e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
};
