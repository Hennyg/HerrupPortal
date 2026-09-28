const { dvFetch, fetchAll } = require("../_dvKunde");

const KUNDE_TABLE = "cr1eb_lch_kundes";
const ADRESSE_TABLE = "cr1eb_lch_kundeadresses";
const PRODUKT_TABLE = "cr1eb_lch_kundeprodukts";

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}
function esc(s) { return String(s || "").replace(/'/g, "''"); }

function mapKunde(r) {
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
function mapAdresse(r) {
  return {
    id: r.cr1eb_lch_kundeadresseid,
    adressekey: r.cr1eb_lch_adressekey || "",
    adresse: r.cr1eb_lch_adresse || "",
    postnr: r.cr1eb_lch_postnr || "",
    by: r.cr1eb_lch_by || "",
    omraade: r.cr1eb_lch_omraade || "",
    aktiv: r.cr1eb_lch_aktiv ?? true
  };
}
function mapProdukt(r) {
  return {
    id: r.cr1eb_lch_kundeproduktid,
    navn: r.cr1eb_lch_kundeproduktnavn || "",
    kundenr: r.cr1eb_lch_kundenr || "",
    adressekey: r.cr1eb_lch_adressekey || "",
    produkt: r.cr1eb_lch_produkt || "",
    produktnr: r.cr1eb_lch_produktnr || "",
    serienr: r.cr1eb_lch_serienr || "",
    kontrakt: r.cr1eb_lch_kontrakt || "",
    matchstatus: r.cr1eb_lch_matchstatus || "",
    datakvalitet: r.cr1eb_lch_datakvalitet || "",
    installationsdato: r.cr1eb_lch_installationsdato || "",
    garantistart: r.cr1eb_lch_garantistart || "",
    garantiudloeb: r.cr1eb_lch_garantiudloeb || "",
    aktiv: r.cr1eb_lch_aktiv ?? true,
    sidstImporteret: r.cr1eb_lch_sidst_importeret || ""
  };
}

module.exports = async function (context, req) {
  try {
    const kundenr = String(req.query.kundenr || "").trim();
    const id = String(req.query.id || "").trim();
    if (!kundenr && !id) return json(context, 400, { error: "Mangler id eller kundenr" });

    const kundeFilter = id
      ? `cr1eb_lch_kundeid eq ${id}`
      : `cr1eb_lch_kundenr eq '${esc(kundenr)}'`;

    const kundeData = await dvFetch(`${KUNDE_TABLE}?$select=cr1eb_lch_kundeid,cr1eb_lch_kundenr,cr1eb_lch_navn,cr1eb_lch_omraade,cr1eb_lch_kundestatus,cr1eb_lch_aktiv,cr1eb_lch_sidst_importeret,modifiedon&$filter=${encodeURIComponent(kundeFilter)}&$top=1`);
    const kunde = (kundeData.value || [])[0];
    if (!kunde) return json(context, 404, { error: "Kunde ikke fundet" });

    const k = mapKunde(kunde);
    const adresseFilter = `_cr1eb_lch_kunde_value eq '${k.id}'`;
    const produktFilter = `cr1eb_lch_kundenr eq '${esc(k.kundenr)}'`;

    const adresser = (await fetchAll(`${ADRESSE_TABLE}?$select=cr1eb_lch_kundeadresseid,cr1eb_lch_adressekey,cr1eb_lch_adresse,cr1eb_lch_postnr,cr1eb_lch_by,cr1eb_lch_omraade,cr1eb_lch_aktiv&$filter=${encodeURIComponent(adresseFilter)}&$orderby=cr1eb_lch_adresse asc&$top=5000`)).map(mapAdresse);

    const produkter = (await fetchAll(`${PRODUKT_TABLE}?$select=cr1eb_lch_kundeproduktid,cr1eb_lch_kundeproduktnavn,cr1eb_lch_kundenr,cr1eb_lch_adressekey,cr1eb_lch_produkt,cr1eb_lch_produktnr,cr1eb_lch_serienr,cr1eb_lch_kontrakt,cr1eb_lch_matchstatus,cr1eb_lch_datakvalitet,cr1eb_lch_installationsdato,cr1eb_lch_garantistart,cr1eb_lch_garantiudloeb,cr1eb_lch_aktiv,cr1eb_lch_sidst_importeret&$filter=${encodeURIComponent(produktFilter)}&$orderby=cr1eb_lch_produkt asc&$top=5000`)).map(mapProdukt);

    json(context, 200, { kunde: k, adresser, produkter });
  } catch (e) {
    context.log("kunde error", e.message);
    json(context, e.status || 500, { error: e.message, stack: e.stack });
  }
};



