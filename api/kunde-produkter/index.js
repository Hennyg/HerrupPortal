// api/kunde-produkter/index.js
// GET /api/kunde-produkter → { produkter: [...] }
// Alle aktive produkter med options (cr1eb_lch_udstyr) – bruges af
// "Udskriv liste" på kundelisten, når der vælges én linje pr. produkt.
// Caches 2 min.

const N = require("../_news");
const { fetchAll } = require("../_dvKunde");

const PRODUKT_TABLE = "cr1eb_lch_kundeprodukts";
const ADRESSE_TABLE = "cr1eb_lch_kundeadresses";
const SELECT = [
  "cr1eb_lch_kundenr", "cr1eb_lch_produkt", "cr1eb_lch_kundeproduktnavn", "cr1eb_lch_produktnr",
  "cr1eb_lch_serienr", "cr1eb_lch_kontrakt", "cr1eb_lch_installationsdato", "cr1eb_lch_garantistart",
  "cr1eb_lch_garantiudloeb", "cr1eb_lch_note", "cr1eb_lch_adressekey", "cr1eb_lch_udstyr",
  "cr1eb_lch_naesteservicedato", "cr1eb_lch_naesteservicetype", "cr1eb_lch_tagstype",
  "cr1eb_lch_recognition", "cr1eb_lch_receiver"
].join(",");

// cr1eb_lch_udstyr er JSON: { "MQC-C": "1", "SAND": "x", ... } (kun udfyldte kolonner)
function parseUdstyr(s) {
  if (!s) return {};
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

let cache = { at: 0, produkter: null };

module.exports = async function (context, req) {
  if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });
  try {
    if (!cache.produkter || Date.now() - cache.at > 2 * 60 * 1000) {
      const filter = encodeURIComponent("cr1eb_lch_aktiv eq true");
      const [rows, adr] = await Promise.all([
        fetchAll(`${PRODUKT_TABLE}?$select=${SELECT}&$filter=${filter}`),
        // Produktets adresse (via adressekey) – til Adresse/Postnr./By i udskriften
        fetchAll(`${ADRESSE_TABLE}?$select=cr1eb_lch_adressekey,cr1eb_lch_adresse,cr1eb_lch_postnr,cr1eb_lch_by`).catch(() => [])
      ]);
      const adrByKey = new Map(adr.map(a => [String(a.cr1eb_lch_adressekey || ""), a]));
      cache = {
        at: Date.now(),
        produkter: rows.map(r => ({
          kundenr: String(r.cr1eb_lch_kundenr || "").trim(),
          produkt: r.cr1eb_lch_produkt || r.cr1eb_lch_kundeproduktnavn || "",
          produktnr: r.cr1eb_lch_produktnr || "",
          serienr: r.cr1eb_lch_serienr || "",
          kontrakt: r.cr1eb_lch_kontrakt || "",
          installationsdato: r.cr1eb_lch_installationsdato || "",
          garantistart: r.cr1eb_lch_garantistart || "",
          garantiudloeb: r.cr1eb_lch_garantiudloeb || "",
          note: r.cr1eb_lch_note || "",
          adressekey: r.cr1eb_lch_adressekey || "",
          adresse: String(adrByKey.get(String(r.cr1eb_lch_adressekey || ""))?.cr1eb_lch_adresse || "").trim(),
          postnr: String(adrByKey.get(String(r.cr1eb_lch_adressekey || ""))?.cr1eb_lch_postnr || "").trim(),
          by: String(adrByKey.get(String(r.cr1eb_lch_adressekey || ""))?.cr1eb_lch_by || "").trim(),
          naesteservicedato: r.cr1eb_lch_naesteservicedato || "",
          naesteservicetype: r.cr1eb_lch_naesteservicetype || "",
          tagstype: r.cr1eb_lch_tagstype || "",
          recognition: r.cr1eb_lch_recognition || "",
          receiver: r.cr1eb_lch_receiver || "",
          udstyr: parseUdstyr(r.cr1eb_lch_udstyr)
        }))
      };
    }
    return N.json(context, 200, { produkter: cache.produkter });
  } catch (e) {
    context.log("kunde-produkter ERROR:", e.message);
    return N.json(context, 500, { error: e.message, produkter: [] });
  }
};
