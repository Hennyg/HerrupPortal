const { fetchAll } = require("../_dvKunde");

const TABLE = "cr1eb_lch_kundes";
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

module.exports = async function (context, req) {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const aktiv = String(req.query.aktiv || "true").toLowerCase();

    let filter = "";
    if (aktiv === "true") filter = "cr1eb_lch_aktiv eq true";
    if (aktiv === "false") filter = "cr1eb_lch_aktiv eq false";

    const path = `${TABLE}?$select=${SELECT}${filter ? `&$filter=${encodeURIComponent(filter)}` : ""}&$orderby=cr1eb_lch_navn asc&$top=5000`;
    let rows = (await fetchAll(path)).map(mapRow);

    if (q.length >= 2) {
      rows = rows.filter(k => [k.kundenr, k.navn, k.omraade, k.kundestatus].join(" ").toLowerCase().includes(q));
    }

    json(context, 200, { kunder: rows, total: rows.length });
  } catch (e) {
    context.log("kunder error", e.message);
    json(context, e.status || 500, { error: e.message, kunder: [] });
  }
};


