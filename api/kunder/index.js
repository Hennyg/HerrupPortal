const { fetchAll } = require("../_dvKunde");

const TABLE = "cr1eb_lch_kundes";
const PRODUKT_TABLE = "cr1eb_lch_kundeprodukts";
const SELECT = [
  "cr1eb_lch_kundeid",
  "cr1eb_lch_kundenr",
  "cr1eb_lch_navn",
  "cr1eb_lch_omraade",
  "cr1eb_lch_kundestatus",
  "cr1eb_lch_aktiv",
  "cr1eb_lch_sidst_importeret",
  "modifiedon"
].join(",");

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

function mapRow(r) {
  return {
    id: r.cr1eb_lch_kundeid,
    kundenr: r.cr1eb_lch_kundenr || "",
    navn: r.cr1eb_lch_navn || "",
    omraade: r.cr1eb_lch_omraade || "",
    kundestatus: r.cr1eb_lch_kundestatus || "",
    aktiv: r.cr1eb_lch_aktiv ?? true,
    sidstImporteret: r.cr1eb_lch_sidst_importeret || "",
    modifiedon: r.modifiedon || ""
  };
}

// Én gennemgang af alle aktive produkter:
//  - xx:         kundenumre med mindst ét produkt, hvor installationsdato
//                indeholder "xx", fx "xx-xx-xxxx" (= ikke aktivt endnu,
//                samme regel som på kunde.html)
//  - kontrakter: kundenr -> { kontrakttype: antal produkter }
//  - serier:     kundenr -> [serienumre] (så kundelisten kan søge på serienr.)
// Fejler stille, så kundelisten altid kan vises.
async function produktInfo(context) {
  const xx = new Set();
  const kontrakter = new Map();
  const serier = new Map();
  try {
    const filter = "cr1eb_lch_aktiv eq true";
    const rows = await fetchAll(`${PRODUKT_TABLE}?$select=cr1eb_lch_kundenr,cr1eb_lch_kontrakt,cr1eb_lch_installationsdato,cr1eb_lch_serienr&$filter=${encodeURIComponent(filter)}&$top=5000`);
    for (const r of rows) {
      const nr = String(r.cr1eb_lch_kundenr || "").trim();
      if (!nr) continue;
      if (/xx/i.test(String(r.cr1eb_lch_installationsdato || ""))) xx.add(nr);
      const sn = String(r.cr1eb_lch_serienr || "").trim();
      if (sn) {
        if (!serier.has(nr)) serier.set(nr, []);
        serier.get(nr).push(sn);
      }
      const k = String(r.cr1eb_lch_kontrakt || "").trim();
      if (!k) continue;
      if (!kontrakter.has(nr)) kontrakter.set(nr, {});
      const m = kontrakter.get(nr);
      m[k] = (m[k] || 0) + 1;
    }
  } catch (e) {
    context.log("kunder: kunne ikke hente produkter", e.message);
  }
  return { xx, kontrakter, serier };
}

// { "Master A5": 3, "Garanti A5": 1 } -> "Master A5+Garanti A5" (flest først)
function kontraktTekst(m) {
  if (!m) return "";
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "da"))
    .map(([k]) => k)
    .join("+");
}

module.exports = async function (context, req) {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const aktiv = String(req.query.aktiv || "true").toLowerCase();

    let filter = "";
    if (aktiv === "true") filter = "cr1eb_lch_aktiv eq true";
    if (aktiv === "false") filter = "cr1eb_lch_aktiv eq false";

    const path = `${TABLE}?$select=${SELECT}${filter ? `&$filter=${encodeURIComponent(filter)}` : ""}&$orderby=cr1eb_lch_navn asc&$top=5000`;
    const [raw, info] = await Promise.all([fetchAll(path), produktInfo(context)]);
    let rows = raw.map(mapRow).map(k => {
      const nr = String(k.kundenr).trim();
      const m = info.kontrakter.get(nr) || null;
      return { ...k, harXX: info.xx.has(nr), kontrakt: kontraktTekst(m), kontraktAntal: m || {}, serier: info.serier.get(nr) || [] };
    });

    if (q.length >= 2) {
      rows = rows.filter(k => [k.kundenr, k.navn, k.omraade, k.kundestatus, k.kontrakt, ...k.serier].join(" ").toLowerCase().includes(q));
    }

    json(context, 200, { kunder: rows, total: rows.length });
  } catch (e) {
    context.log("kunder error", e.message);
    json(context, e.status || 500, { error: e.message, kunder: [] });
  }
};



