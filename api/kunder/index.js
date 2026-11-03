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

// Kundenumre med mindst ét aktivt produkt, hvor installationsdato indeholder
// "xx", fx "xx-xx-xxxx" (= ikke aktivt endnu - samme regel som på kunde.html).
// Fejler stille, så kundelisten altid kan vises.
async function kundenrMedXX(context) {
  try {
    const filter = "cr1eb_lch_aktiv eq true and contains(cr1eb_lch_installationsdato,'xx')";
    const rows = await fetchAll(`${PRODUKT_TABLE}?$select=cr1eb_lch_kundenr,cr1eb_lch_installationsdato&$filter=${encodeURIComponent(filter)}&$top=5000`);
    return new Set(rows
      .filter(r => /xx/i.test(String(r.cr1eb_lch_installationsdato || "")))
      .map(r => String(r.cr1eb_lch_kundenr || "").trim())
      .filter(Boolean));
  } catch (e) {
    context.log("kunder: kunne ikke hente xx-produkter", e.message);
    return new Set();
  }
}

module.exports = async function (context, req) {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const aktiv = String(req.query.aktiv || "true").toLowerCase();

    let filter = "";
    if (aktiv === "true") filter = "cr1eb_lch_aktiv eq true";
    if (aktiv === "false") filter = "cr1eb_lch_aktiv eq false";

    const path = `${TABLE}?$select=${SELECT}${filter ? `&$filter=${encodeURIComponent(filter)}` : ""}&$orderby=cr1eb_lch_navn asc&$top=5000`;
    const [raw, xx] = await Promise.all([fetchAll(path), kundenrMedXX(context)]);
    let rows = raw.map(mapRow).map(k => ({ ...k, harXX: xx.has(String(k.kundenr).trim()) }));

    if (q.length >= 2) {
      rows = rows.filter(k => [k.kundenr, k.navn, k.omraade, k.kundestatus].join(" ").toLowerCase().includes(q));
    }

    json(context, 200, { kunder: rows, total: rows.length });
  } catch (e) {
    context.log("kunder error", e.message);
    json(context, e.status || 500, { error: e.message, kunder: [] });
  }
};
