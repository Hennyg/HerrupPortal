// /api/foder-opgaver/index.js
// GET            → aktive opgaver (?alle=1 giver også inaktive) + isAdmin
// POST   (admin) → { navn, sortering } opretter én opgave
//                  { standard: true } indsætter standardlisten (kun hvis tabellen er tom)
// PATCH  (admin) → ?id=...  { navn?, sortering?, aktiv? }
// DELETE (admin) → ?id=...
const F = require("../_foder");
const O = F.OPG;

const STANDARD = [
  "Besøgs beskrivelse",
  "Analyse udtagning",
  "Bovaer udkast",
  "Foderplaner",
  "Besøg inkl. forberedelse",
  "Majs tjek",
  "EFK",
  "Staldmøde inkl. forberedelse",
  "Foderplan justering",
  "Ko tjek",
  "Bæredygtighedstillæg",
  "Gennemgang af tal",
  "Udkast dagsorden",
  "Benchmark",
  "Kornforbrug"
];

function mapRow(r) {
  return {
    id: r[O.ID],
    navn: r[O.navn] || "",
    sortering: r[O.sortering] ?? 0,
    aktiv: r[O.aktiv] !== false
  };
}

async function listAll() {
  const select = [O.ID, O.navn, O.sortering, O.aktiv].join(",");
  const rows = await F.fetchAll(`${O.TABLE}?$select=${select}&$orderby=${O.sortering} asc,${O.navn} asc`);
  return rows.map(mapRow);
}

module.exports = async function (context, req) {
  const method = String(req.method || "GET").toUpperCase();
  const user = await F.requireAccess(context, req, { admin: method !== "GET" });
  if (!user) return;

  try {
    if (method === "GET") {
      const alle = String(req.query.alle || "") === "1";
      const items = (await listAll()).filter(x => alle || x.aktiv);
      return F.json(context, 200, { items, isAdmin: user.isAdmin, user: { name: user.name, email: user.email } });
    }

    const body = F.readBody(req);

    if (method === "POST") {
      if (body.standard === true) {
        const existing = await listAll();
        if (existing.length) return F.json(context, 409, { error: "Der findes allerede opgaver – standardlisten indsættes kun i en tom tabel" });
        for (let i = 0; i < STANDARD.length; i++) {
          await F.dvFetch(O.TABLE, { method: "POST", body: { [O.navn]: STANDARD[i], [O.sortering]: (i + 1) * 10, [O.aktiv]: true } });
        }
        return F.json(context, 200, { items: await listAll() });
      }

      const navn = String(body.navn || "").trim().slice(0, 200);
      if (!navn) return F.json(context, 400, { error: "Navn mangler" });
      let sortering = parseInt(body.sortering, 10);
      if (!Number.isFinite(sortering)) {
        const all = await listAll();
        sortering = (all.reduce((m, x) => Math.max(m, x.sortering || 0), 0)) + 10;
      }
      await F.dvFetch(O.TABLE, { method: "POST", body: { [O.navn]: navn, [O.sortering]: sortering, [O.aktiv]: true } });
      return F.json(context, 200, { items: await listAll() });
    }

    const id = F.cleanId(req.query.id);
    if (!id) return F.json(context, 400, { error: "Ugyldigt id" });

    if (method === "PATCH") {
      const patch = {};
      if (body.navn !== undefined) {
        const navn = String(body.navn || "").trim().slice(0, 200);
        if (!navn) return F.json(context, 400, { error: "Navn må ikke være tomt" });
        patch[O.navn] = navn;
      }
      if (body.sortering !== undefined) {
        const s = parseInt(body.sortering, 10);
        if (!Number.isFinite(s)) return F.json(context, 400, { error: "Sortering skal være et tal" });
        patch[O.sortering] = s;
      }
      if (body.aktiv !== undefined) patch[O.aktiv] = body.aktiv === true;
      if (!Object.keys(patch).length) return F.json(context, 400, { error: "Intet at opdatere" });
      await F.dvFetch(`${O.TABLE}(${id})`, { method: "PATCH", body: patch });
      return F.json(context, 200, { items: await listAll() });
    }

    if (method === "DELETE") {
      await F.dvFetch(`${O.TABLE}(${id})`, { method: "DELETE" });
      return F.json(context, 200, { items: await listAll() });
    }

    return F.json(context, 405, { error: "Metode ikke understøttet" });
  } catch (e) {
    context.log.error("foder-opgaver:", e);
    return F.json(context, e.status || 500, { error: e.message });
  }
};
