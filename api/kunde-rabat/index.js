// api/kunde-rabat/index.js
// Kemi-rabatordningen.
//
// Alle indloggede:
//   GET    ?kundenr=<nr>            → { rabat, struktur, historik }   (kunde.html)
//
// Kun portal_admin / portal_kundeliste_admin:
//   GET    ?action=liste            → { items, struktur, kommentarKolonne }
//   POST   ?action=gem              body { kundenr, gruppe?, robot?, yverpleje?, tank?, kommentar?, rabatchange? } (kun ændrede felter)
//   POST   ?action=import           body { rows: [{ kundenr, gruppe, robot, yverpleje, tank, rabatchange, kommentar, ark }] }
//   POST   ?action=struktur         body { items: [{ id?, gruppe, koebsgraense, rabatprocent, farve }] }
//   DELETE ?action=struktur&id=<guid>

const N = require("../_news");
const A = require("../_kundelisteAdmin");
const R = require("../_rabat");

module.exports = async function (context, req) {
  const action = String(req.query.action || "").toLowerCase();
  const method = String(req.method || "GET").toUpperCase();

  try {
    const me = N.getPrincipal(req);
    if (!me) return N.json(context, 401, { error: "Ikke logget ind" });

    // Læsning til kundesiden
    if (!action && method === "GET") {
      const kundenr = String(req.query.kundenr || "").trim();
      if (!kundenr) return N.json(context, 400, { error: "kundenr mangler" });
      const [rabat, struktur, historik] = await Promise.all([R.rabatForKunde(kundenr), R.listStruktur(), R.historik(kundenr)]);
      return N.json(context, 200, { rabat, struktur, historik });
    }

    const { admin } = await A.isKundelisteAdmin(req);
    if (!admin) return N.json(context, 403, { error: "Kræver rollen portal_admin eller portal_kundeliste_admin" });
    const af = String(me.email || me.userDetails || "").trim();

    if (action === "liste" && method === "GET") {
      const [items, struktur, types] = await Promise.all([R.listRabat(), R.listStruktur(), R.attrTypes()]);
      return N.json(context, 200, { items, struktur, kommentarKolonne: R.hasKommentar(types) });
    }
    if (action === "historik" && method === "GET") {
      return N.json(context, 200, { items: await R.historik(req.query.kundenr) });
    }
    if (action === "gem" && method === "POST") {
      const b = req.body || {};
      const input = { kundenr: b.kundenr };
      for (const f of ["gruppe", "robot", "yverpleje", "tank", "kommentar", "rabatchange"]) if (f in b) input[f] = b[f];
      return N.json(context, 200, await R.gemRabat(input, { kilde: "Portal", af }));
    }
    if (action === "import" && method === "POST") {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 50) : [];
      if (!rows.length) return N.json(context, 400, { error: "Ingen rækker" });
      return N.json(context, 200, { results: await R.importer(rows, af) });
    }
    if (action === "struktur") {
      if (method === "POST")   { await R.gemStruktur(req.body?.items || []); return N.json(context, 200, { items: await R.listStruktur() }); }
      if (method === "DELETE") { await R.sletStruktur(req.query.id); return N.json(context, 200, { ok: true }); }
    }

    return N.json(context, 400, { error: `Ukendt handling: ${method} ${action || "(ingen)"}` });
  } catch (e) {
    context.log("kunde-rabat ERROR:", e.message);
    return N.json(context, e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
};
