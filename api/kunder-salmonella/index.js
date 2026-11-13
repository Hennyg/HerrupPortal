// api/kunder-salmonella/index.js
//
// GET /api/kunder-salmonella  ->  { red: ["kundenr", ...], beregnet: "<ISO-tid>" }
//
// Kundenumre, hvor mindst én af kundens adresser har en besætning, der IKKE
// er salmonella-fri. Samme regel som den røde ramme på kunde.html:
//   - besætningen kobles på ejendommens adresse (brugerens/ejerens kun, hvis
//     ejendomsadressen mangler)
//   - vej + husnr. skal være ens (store/små bogstaver, mellemrum og
//     tegnsætning ignoreres), og postnr. skal være ens, hvis begge har et
//   - status forskellig fra "Fri" (også tom/ukendt) tæller som rød
//
// Bruges af kundeliste.html til at farve kundenummeret rødt. Resultatet
// huskes 15 min. pr. Functions-instans, så listen ikke venter på det.

const { fetchAll } = require("../_dvKunde");
const { helpers: S } = require("../kunde-salmonella");

const ADRESSE_TABLE = "cr1eb_lch_kundeadresses";
const KUNDE_TABLE = "cr1eb_lch_kundes";
const CACHE_MS = 15 * 60 * 1000;
let cache = { at: 0, body: null };

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

const pnOf = v => String(v ?? "").replace(/[^0-9]/g, "");

// Alle besætninger, der ikke er fri: Map normAdr -> [postnr, ...]
async function redHerdAddresses() {
  const resource = S.dvUrl();
  const token = await S.getToken(resource);
  const table = process.env.CHR_TABLE_PLURAL || "cr406_chrdatas";
  const select = [
    "cr406_chr", "cr406_uisygdomsniveautekst",
    "cr406_ejendomadresse", "cr406_ejendompostnr",
    "cr406_brugeradresse", "cr406_brugerpostnummer"
  ].join(",");

  let url = `${resource}/api/data/v9.2/${table}?$select=${select}`;
  const map = new Map();
  while (url) {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Prefer: "odata.maxpagesize=5000"
      }
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`chr_dv_error ${r.status}: ${txt.slice(0, 300)}`);
    const j = JSON.parse(txt);
    for (const row of j.value || []) {
      const fri = String(row.cr406_uisygdomsniveautekst || "").trim().toLowerCase() === "fri";
      if (fri) continue;
      const [adr, pn] = row.cr406_ejendomadresse
        ? [row.cr406_ejendomadresse, row.cr406_ejendompostnr]
        : [row.cr406_brugeradresse, row.cr406_brugerpostnummer];
      const key = S.normAdr(adr);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(pnOf(pn));
    }
    url = j["@odata.nextLink"] || null;
  }
  return map;
}

module.exports = async function (context, req) {
  try {
    const refresh = req.query.refresh === "1";
    if (!refresh && cache.body && Date.now() - cache.at < CACHE_MS) {
      return json(context, 200, cache.body);
    }

    const [red, adresser, kunder] = await Promise.all([
      redHerdAddresses(),
      fetchAll(`${ADRESSE_TABLE}?$select=cr1eb_lch_adresse,cr1eb_lch_postnr,_cr1eb_lch_kunde_value&$top=5000`),
      fetchAll(`${KUNDE_TABLE}?$select=cr1eb_lch_kundeid,cr1eb_lch_kundenr&$top=5000`)
    ]);

    const kundenrById = new Map(kunder.map(k => [k.cr1eb_lch_kundeid, String(k.cr1eb_lch_kundenr || "").trim()]));
    const redKunder = new Set();

    for (const a of adresser) {
      const herdPns = red.get(S.normAdr(a.cr1eb_lch_adresse));
      if (!herdPns) continue;
      const ap = pnOf(a.cr1eb_lch_postnr);
      if (!herdPns.some(hp => !hp || !ap || hp === ap)) continue;
      const nr = kundenrById.get(a._cr1eb_lch_kunde_value);
      if (nr) redKunder.add(nr);
    }

    const body = { red: [...redKunder].sort(), beregnet: new Date().toISOString() };
    cache = { at: Date.now(), body };
    json(context, 200, body);
  } catch (e) {
    context.log.error("kunder-salmonella:", e.message);
    json(context, 500, { error: e.message });
  }
};
