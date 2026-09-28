const { fetchAll } = require("../_dvKunde");
const TABLE = "cr1eb_lch_importlogs";
const SELECT = [
  "cr1eb_lch_importlogid",
  "cr1eb_lch_importid",
  "cr1eb_lch_importnavn",
  "cr1eb_lch_filnavn",
  "cr1eb_lch_starttid",
  "cr1eb_lch_sluttid",
  "cr1eb_lch_varighed",
  "cr1eb_lch_version",
  "cr1eb_lch_computer",
  "cr1eb_lch_status",
  "cr1eb_lch_antal_laest",
  "cr1eb_lch_antal_kunder",
  "cr1eb_lch_antal_adresser",
  "cr1eb_lch_antal_produkter",
  "cr1eb_lch_antal_oprettet",
  "cr1eb_lch_antal_opdateret",
  "cr1eb_lch_antal_deaktiveret",
  "cr1eb_lch_antal_fejl",
  "cr1eb_lch_fejlbesked",
  "cr1eb_lch_fejllinjer",
  "cr1eb_lch_opdateret",
  "createdon"
].join(",");
function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}
function mapRow(r) {
  return {
    id: r.cr1eb_lch_importlogid,
    importid: r.cr1eb_lch_importid || "",
    importnavn: r.cr1eb_lch_importnavn || "",
    filnavn: r.cr1eb_lch_filnavn || "",
    starttid: r.cr1eb_lch_starttid || "",
    sluttid: r.cr1eb_lch_sluttid || "",
    varighed: r.cr1eb_lch_varighed || "",
    version: r.cr1eb_lch_version || "",
    computer: r.cr1eb_lch_computer || "",
    status: r.cr1eb_lch_status || "",
    laest: r.cr1eb_lch_antal_laest || "",
    kunder: r.cr1eb_lch_antal_kunder || "",
    adresser: r.cr1eb_lch_antal_adresser || "",
    produkter: r.cr1eb_lch_antal_produkter || "",
    oprettet: r.cr1eb_lch_antal_oprettet || "",
    opdateret: r.cr1eb_lch_antal_opdateret || "",
    deaktiveret: r.cr1eb_lch_antal_deaktiveret || "",
    fejl: r.cr1eb_lch_antal_fejl || "",
    fejlbesked: r.cr1eb_lch_fejlbesked || "",
    fejllinjer: r.cr1eb_lch_fejllinjer || "",
    opdateretTekst: r.cr1eb_lch_opdateret || "",
    createdon: r.createdon || ""
  };
}
module.exports = async function (context, req) {
  try {
    const rows = (await fetchAll(`${TABLE}?$select=${SELECT}&$orderby=createdon desc&$top=500`)).map(mapRow);
    json(context, 200, { logs: rows, total: rows.length });
  } catch (e) {
    context.log("importlog error", e.message);
    json(context, e.status || 500, { error: e.message, logs: [] });
  }
};


