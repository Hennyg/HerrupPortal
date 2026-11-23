const { fetchAll, dvFetch } = require("../_dvKunde");

const TABLE = "cr1eb_lch_kundes";
const PRODUKT_TABLE = "cr1eb_lch_kundeprodukts";
const ADRESSE_TABLE = "cr1eb_lch_kundeadresses";
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

// Ekstra kundefelter, som importen fra regnearket skriver, HVIS kolonnen findes
// i Dataverse (se Sync-NasExcel-To-Dataverse.ps1). Findes en kolonne ikke,
// udelades den, så kundelisten ikke fejler.
const EXTRA = {
  infomail:        "cr1eb_lch_infomail",          // "INFO Mail-adresse"
  betaling:        "cr1eb_lch_betaling",          // "Betaling"
  unicontaKundenr: "cr1eb_lch_unicontakundenr"    // "Kundenr. Uniconta"
};
let extraOk = null;               // [{ key, field }] – slås op én gang
async function extraFields() {
  if (extraOk) return extraOk;
  const ok = [];
  for (const [key, field] of Object.entries(EXTRA)) {
    try {
      await dvFetch(`EntityDefinitions(LogicalName='cr1eb_lch_kunde')/Attributes(LogicalName='${field}')?$select=LogicalName`);
      ok.push({ key, field });
    } catch { /* kolonnen findes ikke */ }
  }
  extraOk = ok;
  return ok;
}

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

// Én gennemgang af alle adresser (ingen $top, så fetchAll følger @odata.nextLink):
//  - antal:   kunde-id -> antal adresser (til "Flere adresser")
//  - postnr:  kunde-id -> [unikke postnumre] (så kundelisten kan søge på postnr.)
// Returnerer null ved fejl.
async function adresseInfo(context) {
  try {
    const rows = await fetchAll(`${ADRESSE_TABLE}?$select=_cr1eb_lch_kunde_value,cr1eb_lch_postnr`);
    const antal = new Map();
    const postnr = new Map();
    for (const a of rows) {
      const id = a._cr1eb_lch_kunde_value;
      if (!id) continue;
      antal.set(id, (antal.get(id) || 0) + 1);
      const pn = String(a.cr1eb_lch_postnr || "").trim();
      if (pn) {
        if (!postnr.has(id)) postnr.set(id, new Set());
        postnr.get(id).add(pn);
      }
    }
    return { antal, postnr };
  } catch (e) {
    context.log("kunder: kunne ikke hente adresser", e.message);
    return null;
  }
}

// { "Master A5": 3, "Garanti A5": 1 } -> "Master A5+Garanti A5" (flest først)
function kontraktTekst(m) {
  if (!m) return "";
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "da"))
    .map(([k]) => k)
    .join("+");
}

// Salmonella pr. kunde (kundenr -> [{ chr, status, adresse }]). Fejler det,
// vises kundelisten stadig - bare uden røde markeringer.
async function salmonellaInfo(context) {
  try {
    const { salmonellaPrKunde } = require("../kunder-salmonella");
    return await salmonellaPrKunde();
  } catch (e) {
    context.log("kunder: kunne ikke hente salmonella", e.message);
    return null;
  }
}

module.exports = async function (context, req) {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const aktiv = String(req.query.aktiv || "true").toLowerCase();
    const flereAdresser = aktiv === "flereadresser";

    let filter = "";
    if (aktiv === "true" || flereAdresser) filter = "cr1eb_lch_aktiv eq true";
    if (aktiv === "false") filter = "cr1eb_lch_aktiv eq false";

    const extra = await extraFields();
    const select = [SELECT, ...extra.map(x => x.field)].join(",");
    const path = `${TABLE}?$select=${select}${filter ? `&$filter=${encodeURIComponent(filter)}` : ""}&$orderby=cr1eb_lch_navn asc&$top=5000`;
    const [raw, info, sal, adr] = await Promise.all([
      fetchAll(path),
      produktInfo(context),
      salmonellaInfo(context),
      adresseInfo(context)
    ]);

    if (flereAdresser && !adr) {
      return json(context, 502, { error: "Kunne ikke hente adresser til filteret 'Flere adresser'.", kunder: [] });
    }

    let rows = raw.map(r => {
      const k = mapRow(r);
      for (const x of extra) k[x.key] = String(r[x.field] || "").trim();
      return k;
    }).map(k => {
      const nr = String(k.kundenr).trim();
      const m = info.kontrakter.get(nr) || null;
      return {
        ...k, harXX: info.xx.has(nr), kontrakt: kontraktTekst(m), kontraktAntal: m || {}, serier: info.serier.get(nr) || [],
        // Besætninger på kundens adresser, der ikke er salmonella-fri
        salmonella: sal ? (sal.get(nr) || []) : [],
        antalAdresser: adr ? (adr.antal.get(k.id) || 0) : null,
        postnumre: adr ? [...(adr.postnr.get(k.id) || [])] : []
      };
    });

    // "Flere adresser": kun aktive kunder med mere end én adresse
    if (flereAdresser) {
      rows = rows.filter(k => k.antalAdresser > 1);
    }

    if (q.length >= 2) {
      rows = rows.filter(k => [k.kundenr, k.navn, k.omraade, k.kundestatus, k.kontrakt, k.infomail || "", ...k.serier, ...k.postnumre].join(" ").toLowerCase().includes(q));
    }

    json(context, 200, { kunder: rows, total: rows.length, salmonellaOk: !!sal });
  } catch (e) {
    context.log("kunder error", e.message);
    json(context, e.status || 500, { error: e.message, kunder: [] });
  }
};
