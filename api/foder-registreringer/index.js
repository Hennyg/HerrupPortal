// /api/foder-registreringer/index.js
// GET    → registreringer (ufakturerede; ?alle=1 giver også fakturerede) + isAdmin
// POST   → { kundenr, kundenavn, dato, minutter, opgaver[], kommentar } opretter en registrering
// PATCH  → ?id=...  { faktureret: true|false }
// DELETE → ?id=...  (admin, eller rådgiveren selv så længe den ikke er faktureret)
const F = require("../_foder");
const R = F.REG;

const SELECT = [R.ID, R.titel, R.kundenr, R.kundenavn, R.dato, R.minutter, R.opgaver, R.kommentar,
  R.raadgiver, R.raadgiverMail, R.faktureret, R.faktureretDato, R.faktureretAf, "createdon"].join(",");

function mapRow(r) {
  return {
    id: r[R.ID],
    kundenr: r[R.kundenr] || "",
    kundenavn: r[R.kundenavn] || "",
    dato: String(r[R.dato] || "").slice(0, 10),
    minutter: r[R.minutter] ?? 0,
    opgaver: String(r[R.opgaver] || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    kommentar: r[R.kommentar] || "",
    raadgiver: r[R.raadgiver] || "",
    raadgiverMail: r[R.raadgiverMail] || "",
    faktureret: r[R.faktureret] === true,
    faktureretDato: r[R.faktureretDato] || null,
    faktureretAf: r[R.faktureretAf] || "",
    createdon: r.createdon || null
  };
}

async function getOne(id) {
  return mapRow(await F.dvFetch(`${R.TABLE}(${id})?$select=${SELECT}`));
}

module.exports = async function (context, req) {
  const user = await F.requireAccess(context, req);
  if (!user) return;
  const method = String(req.method || "GET").toUpperCase();

  try {
    if (method === "GET") {
      const alle = String(req.query.alle || "") === "1";
      const filter = alle ? "" : `&$filter=${encodeURIComponent(`${R.faktureret} ne true`)}`;
      const rows = await F.fetchAll(`${R.TABLE}?$select=${SELECT}${filter}&$orderby=${R.dato} desc,createdon desc`);
      return F.json(context, 200, {
        items: rows.map(mapRow),
        isAdmin: user.isAdmin,
        user: { name: user.name, email: user.email }
      });
    }

    const body = F.readBody(req);

    if (method === "POST") {
      const kundenr = String(body.kundenr || "").trim().slice(0, 50);
      const kundenavn = String(body.kundenavn || "").trim().slice(0, 200);
      const dato = String(body.dato || "").trim();
      const minutter = parseInt(body.minutter, 10);
      const opgaver = (Array.isArray(body.opgaver) ? body.opgaver : [])
        .map(s => String(s || "").trim()).filter(Boolean).slice(0, 50);
      const kommentar = String(body.kommentar || "").trim().slice(0, 4000);

      if (!kundenr || !kundenavn) return F.json(context, 400, { error: "Kunde mangler" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) return F.json(context, 400, { error: "Ugyldig dato" });
      if (!Number.isFinite(minutter) || minutter <= 0 || minutter % 15 !== 0 || minutter > 5 * 60 + 45) {
        return F.json(context, 400, { error: "Ugyldig tid" });
      }
      if (!opgaver.length) return F.json(context, 400, { error: "Vælg mindst én opgave" });

      const payload = {
        [R.titel]: `${kundenavn} ${dato}`.slice(0, 100),
        [R.kundenr]: kundenr,
        [R.kundenavn]: kundenavn,
        [R.dato]: dato,
        [R.minutter]: minutter,
        [R.opgaver]: opgaver.join("\n"),
        [R.kommentar]: kommentar,
        [R.raadgiver]: user.name,
        [R.raadgiverMail]: user.email,
        [R.faktureret]: false
      };
      const created = await F.dvFetch(R.TABLE, {
        method: "POST",
        body: payload,
        headers: { Prefer: "return=representation" }
      });
      return F.json(context, 200, { item: created ? mapRow(created) : null });
    }

    const id = F.cleanId(req.query.id);
    if (!id) return F.json(context, 400, { error: "Ugyldigt id" });

    if (method === "PATCH") {
      if (typeof body.faktureret !== "boolean") return F.json(context, 400, { error: "faktureret skal være true/false" });
      const patch = body.faktureret
        ? { [R.faktureret]: true, [R.faktureretDato]: new Date().toISOString(), [R.faktureretAf]: user.name }
        : { [R.faktureret]: false, [R.faktureretDato]: null, [R.faktureretAf]: "" };
      await F.dvFetch(`${R.TABLE}(${id})`, { method: "PATCH", body: patch });
      return F.json(context, 200, { item: await getOne(id) });
    }

    if (method === "DELETE") {
      const row = await getOne(id);
      const own = row.raadgiverMail && user.email && row.raadgiverMail.toLowerCase() === user.email.toLowerCase();
      if (!user.isAdmin && !(own && !row.faktureret)) {
        return F.json(context, 403, { error: "Du kan kun slette dine egne ufakturerede registreringer" });
      }
      await F.dvFetch(`${R.TABLE}(${id})`, { method: "DELETE" });
      return F.json(context, 200, { ok: true });
    }

    return F.json(context, 405, { error: "Metode ikke understøttet" });
  } catch (e) {
    context.log.error("foder-registreringer:", e);
    return F.json(context, e.status || 500, { error: e.message });
  }
};
