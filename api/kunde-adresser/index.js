// api/kunde-adresser/index.js
//
// Navn, kundenr, CHR og adresser (+ aktive produkter pr. adresse) for en
// kunde. Samme logik som /api/kunde-adresser i Kundeinfo-appen, men via
// portalens ../_dvKunde (KL_DV_URL + DV_* credentials).

const { dvFetch, fetchAll } = require("../_dvKunde");

const KUNDE_TABLE = "cr1eb_lch_kundes";
const ADRESSE_TABLE = "cr1eb_lch_kundeadresses";
const PRODUKT_TABLE = "cr1eb_lch_kundeprodukts";

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}
function esc(s) { return String(s || "").replace(/'/g, "''"); }

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

module.exports = async function (context, req) {
  try {
    const kundenr = String(req.query.kundenr || "").trim();
    if (!kundenr) return json(context, 400, { error: "Mangler kundenr" });

    const kundeFilter = `cr1eb_lch_kundenr eq '${esc(kundenr)}'`;
    const kundeData = await dvFetch(
      `${KUNDE_TABLE}?$select=cr1eb_lch_kundeid,cr1eb_lch_kundenr,cr1eb_lch_navn,cr1eb_lch_chr,cr1eb_lch_omraade` +
      `&$filter=${encodeURIComponent(kundeFilter)}&$top=1`
    );

    const kunde = (kundeData.value || [])[0];
    if (!kunde) return json(context, 404, { error: "Kunde ikke fundet" });

    const kundeId = kunde.cr1eb_lch_kundeid;
    const adresseFilter = `_cr1eb_lch_kunde_value eq '${kundeId}'`;
    const adresserRaw = await fetchAll(
      `${ADRESSE_TABLE}?$select=cr1eb_lch_kundeadresseid,cr1eb_lch_adressekey,cr1eb_lch_adresse,cr1eb_lch_postnr,cr1eb_lch_by,cr1eb_lch_omraade,cr1eb_lch_aktiv` +
      `&$filter=${encodeURIComponent(adresseFilter)}&$orderby=cr1eb_lch_adresse asc&$top=5000`
    );

    // Ingen aktiv-filter i OData: feltet er ofte null og tolkes som aktivt.
    const produktFilter = `cr1eb_lch_kundenr eq '${esc(kunde.cr1eb_lch_kundenr || kundenr)}'`;
    const produkterRaw = await fetchAll(
      `${PRODUKT_TABLE}?$select=cr1eb_lch_adressekey,cr1eb_lch_produkt,cr1eb_lch_aktiv` +
      `&$filter=${encodeURIComponent(produktFilter)}&$top=5000`
    );

    const counts = {};
    for (const p of produkterRaw) {
      if ((p.cr1eb_lch_aktiv ?? true) === false) continue;
      const key = p.cr1eb_lch_adressekey || "";
      const produkt = p.cr1eb_lch_produkt || "Ukendt";
      if (!counts[key]) counts[key] = {};
      counts[key][produkt] = (counts[key][produkt] || 0) + 1;
    }

    const adresser = adresserRaw.map(r => {
      const a = mapAdresse(r);
      a.produkter = Object.entries(counts[a.adressekey] || {})
        .map(([produkt, antal]) => ({ produkt, antal }))
        .sort((x, y) => y.antal - x.antal || x.produkt.localeCompare(y.produkt, "da"));
      return a;
    });

    json(context, 200, {
      kunde: {
        id: kundeId,
        kundenr: kunde.cr1eb_lch_kundenr || "",
        navn: kunde.cr1eb_lch_navn || "",
        chr: String(kunde.cr1eb_lch_chr || "").trim(),
        omraade: kunde.cr1eb_lch_omraade || ""
      },
      adresser
    });
  } catch (e) {
    context.log.error("kunde-adresser error", e);
    json(context, e.status || 500, { error: e.message });
  }
};
