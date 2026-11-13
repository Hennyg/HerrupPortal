// api/kunder-salmonella/index.js
//
// GET /api/kunder-salmonella  ->  { kunder: { "<kundenr>": [{ chr, status, adresse }] }, beregnet }
//
// Kunder, hvor mindst én af kundens adresser har en besætning, der IKKE er
// salmonella-fri. Samme regel som den røde ramme på kunde.html:
//   - besætningen kobles på ejendommens adresse (brugerens/ejerens kun, hvis
//     ejendomsadressen mangler)
//   - vej + husnr. skal være ens (store/små bogstaver, mellemrum og
//     tegnsætning ignoreres), og postnr. skal være ens, hvis begge har et
//   - status forskellig fra "Fri" (også tom/ukendt) tæller som rød
//
// /api/kunder bruger salmonellaPrKunde() direkte, så markeringen kommer med
// kundelisten. Resultatet huskes 15 min. pr. Functions-instans.

const { fetchAll } = require("../_dvKunde");
const { helpers: S } = require("../kunde-salmonella");

const ADRESSE_TABLE = "cr1eb_lch_kundeadresses";
const KUNDE_TABLE = "cr1eb_lch_kundes";
const CACHE_MS = 15 * 60 * 1000;
let cache = { at: 0, map: null, pending: null };

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

const pnOf = v => String(v ?? "").replace(/[^0-9]/g, "");

// Alle besætninger, der ikke er fri: Map normAdr -> [{ chr, status, adresse, pn }]
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
      const status = String(row.cr406_uisygdomsniveautekst || "").trim();
      if (status.toLowerCase() === "fri") continue;
      const [adr, pn] = row.cr406_ejendomadresse
        ? [row.cr406_ejendomadresse, row.cr406_ejendompostnr]
        : [row.cr406_brugeradresse, row.cr406_brugerpostnummer];
      const key = S.normAdr(adr);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ chr: String(row.cr406_chr || ""), status: status || "Ukendt", adresse: adr, pn: pnOf(pn) });
    }
    url = j["@odata.nextLink"] || null;
  }
  return map;
}

async function compute() {
  const [red, adresser, kunder] = await Promise.all([
    redHerdAddresses(),
    fetchAll(`${ADRESSE_TABLE}?$select=cr1eb_lch_adresse,cr1eb_lch_postnr,_cr1eb_lch_kunde_value&$top=5000`),
    fetchAll(`${KUNDE_TABLE}?$select=cr1eb_lch_kundeid,cr1eb_lch_kundenr&$top=5000`)
  ]);

  const kundenrById = new Map(kunder.map(k => [k.cr1eb_lch_kundeid, String(k.cr1eb_lch_kundenr || "").trim()]));
  const result = new Map();   // kundenr -> [{ chr, status, adresse }]

  for (const a of adresser) {
    const herds = red.get(S.normAdr(a.cr1eb_lch_adresse));
    if (!herds) continue;
    const ap = pnOf(a.cr1eb_lch_postnr);
    const hits = herds.filter(h => !h.pn || !ap || h.pn === ap);
    if (!hits.length) continue;
    const nr = kundenrById.get(a._cr1eb_lch_kunde_value);
    if (!nr) continue;
    if (!result.has(nr)) result.set(nr, []);
    const list = result.get(nr);
    for (const h of hits) {
      if (!list.some(x => x.chr === h.chr)) list.push({ chr: h.chr, status: h.status, adresse: a.cr1eb_lch_adresse || h.adresse });
    }
  }
  return result;
}

// Map kundenr -> [{ chr, status, adresse }], fra cache hvis muligt.
// Samtidige kald deler den samme beregning.
async function salmonellaPrKunde(refresh = false) {
  if (!refresh && cache.map && Date.now() - cache.at < CACHE_MS) return cache.map;
  if (!cache.pending) {
    cache.pending = compute()
      .then(map => { cache = { at: Date.now(), map, pending: null }; return map; })
      .catch(e => { cache.pending = null; throw e; });
  }
  return cache.pending;
}

module.exports = async function (context, req) {
  try {
    const map = await salmonellaPrKunde(req.query.refresh === "1");
    json(context, 200, { kunder: Object.fromEntries(map), beregnet: new Date(cache.at || Date.now()).toISOString() });
  } catch (e) {
    context.log.error("kunder-salmonella:", e.message);
    json(context, 500, { error: e.message });
  }
};

module.exports.salmonellaPrKunde = salmonellaPrKunde;
