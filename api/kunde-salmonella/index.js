// api/kunde-salmonella/index.js
//
// Henter besætningsdata (salmonella + øvrige sygdomsstatusser) fra
// Salmonella-appens (CHR-external) Dataverse-miljø for ét eller flere
// CHR-numre: /api/kunde-salmonella?chr=12345,67890
//
// Desuden kan kundens adresser slås op direkte i tabellen:
//   /api/kunde-salmonella?chr=...&adr=Kanalvej 20|8500;Dalsagervej 1|8500
// Så findes besætninger på adressen, selvom deres CHR-nr. ikke står på kunden.
// Der matches på ejendommens adresse - brugerens kun, hvis ejendomsadressen
// mangler (vejnavn + husnr. + postnr.,
// store/små bogstaver, mellemrum og tegnsætning ignoreres). Kun eksakte
// match returneres.
//
// App settings:
//   CHR_DV_URL          Salmonella-appens DATAVERSE_URL (påkrævet)
//   CHR_TABLE_PLURAL    valgfri, standard cr406_chrdatas
//   CHR_TENANT_ID / CHR_CLIENT_ID / CHR_CLIENT_SECRET
//                       valgfri - ellers bruges portalens DV_* credentials

const FIELDS = [
  "cr406_chr", "cr406_brugernavn",
  "cr406_uisygdomsniveautekst", "cr406_sdudatoveterinrstatus",
  "cr406_ejendomadresse", "cr406_ejendompostnr", "cr406_ejendomby",
  "cr406_brugeradresse", "cr406_brugerpostnummer", "cr406_brugerbynavn",
  "cr406_kreaturerialt", "cr406_kvier", "cr406_ker",
  "modifiedon",
  "cr406_bludatoveterinrstatus", "cr406_blusygdomstekst", "cr406_bluveterinrstatustekst",
  "cr406_bstdatoveterinrstatus", "cr406_bstsygdomstekst", "cr406_bstveterinrstatustekst",
  "cr406_bvddatoveterinrstatus", "cr406_bvdsygdomstekst", "cr406_bvdveterinrstatustekst",
  "cr406_saddatoveterinrstatus", "cr406_sadsygdomstekst", "cr406_sadveterinrstatustekst",
  "cr406_mtkdatoveterinrstatus", "cr406_mtksygdomstekst", "cr406_mtkveterinrstatustekst",
  "cr406_saldatoveterinrstatus", "cr406_salsygdomstekst", "cr406_salveterinrstatustekst"
];

const SYGDOMME = ["SAL", "BVD", "BLU", "BST", "SAD", "MTK"];

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

function dvUrl() {
  return String(process.env.CHR_DV_URL || "").trim().replace(/\/+$/, "");
}

async function getToken(resource) {
  const tenant = process.env.CHR_TENANT_ID || process.env.DV_TENANT_ID;
  const clientId = process.env.CHR_CLIENT_ID || process.env.DV_CLIENT_ID;
  const clientSecret = process.env.CHR_CLIENT_SECRET || process.env.DV_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret || !resource) {
    throw new Error("Mangler CHR_DV_URL eller DV_TENANT_ID/DV_CLIENT_ID/DV_CLIENT_SECRET");
  }

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: `${resource}/.default`
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

function parseChrList(value) {
  return [...new Set(
    String(value || "")
      .split(/[,;/\s]+/)                 // flere CHR-numre adskilt af , ; / eller mellemrum
      .flatMap(s => {
        const parts = s.split("-").filter(Boolean);
        // "54028-53864" (2 dele) = CHR-besætningsnr. -> kun CHR.
        // "42261-40522-41197-61479-82873" (3+ dele) = flere CHR-numre.
        return parts.length >= 3 ? parts : parts.slice(0, 1);
      })
      .map(s => s.replace(/[^0-9]/g, ""))
      .filter(Boolean)
  )].slice(0, 25);
}

// "Asfergvej 28, Asferg" -> "asfergvej28" (samme regel som kunde.html)
function normAdr(s) {
  return String(s || "").toLowerCase().split(",")[0].replace(/[^a-z0-9æøå]+/g, "");
}

// "Kanalvej 20|8500;Dalsagervej 1|8500" -> [{ adresse, postnr, norm, vej }]
function parseAdrList(value) {
  const seen = new Set();
  const out = [];
  for (const part of String(value || "").split(";")) {
    const [adresse = "", postnr = ""] = part.split("|");
    const norm = normAdr(adresse);
    // Vejnavn = alt før første ciffer ("Kanalvej 20" -> "Kanalvej")
    const vej = adresse.split(",")[0].replace(/\s*\d.*$/, "").trim();
    const pn = postnr.replace(/[^0-9]/g, "");
    if (!norm || !vej || seen.has(norm + "|" + pn)) continue;
    seen.add(norm + "|" + pn);
    out.push({ adresse: adresse.trim(), postnr: pn, norm, vej });
  }
  return out.slice(0, 15);
}

function odataStr(s) { return String(s).replace(/'/g, "''"); }

function mapRow(r) {
  const sygdomme = SYGDOMME.map(kode => {
    const k = kode.toLowerCase();
    return {
      kode,
      sygdom: r[`cr406_${k}sygdomstekst`] || "",
      status: r[`cr406_${k}veterinrstatustekst`] || "",
      dato: r[`cr406_${k}datoveterinrstatus`] || ""
    };
  }).filter(s => s.sygdom || s.status || s.dato);

  return {
    chr: r.cr406_chr || "",
    navn: r.cr406_brugernavn || "",
    adresse: r.cr406_ejendomadresse || r.cr406_brugeradresse || "",
    postnr: r.cr406_ejendompostnr || r.cr406_brugerpostnummer || "",
    by: r.cr406_ejendomby || r.cr406_brugerbynavn || "",
    // Begge adresser, så kunde.html kan koble på den ene eller den anden
    ejendomAdresse: r.cr406_ejendomadresse || "",
    ejendomPostnr: String(r.cr406_ejendompostnr ?? ""),
    brugerAdresse: r.cr406_brugeradresse || "",
    brugerPostnr: String(r.cr406_brugerpostnummer ?? ""),
    salmonellaStatus: r.cr406_uisygdomsniveautekst || "",
    salmonellaDato: r.cr406_sdudatoveterinrstatus || "",
    kreaturerIAlt: r.cr406_kreaturerialt ?? null,
    kvier: r.cr406_kvier ?? null,
    koeer: r.cr406_ker ?? null,
    sygdomme,
    modifiedOn: r.modifiedon || null
  };
}

// Står besætningen på adressen? Ejendommens adresse bruges; brugerens
// (ejerens) adresse kun, hvis besætningen ikke har en ejendomsadresse.
// Samme regel som kunde.html.
function rowMatchesAdr(r, a) {
  const [adr, pn] = r.cr406_ejendomadresse
    ? [r.cr406_ejendomadresse, r.cr406_ejendompostnr]
    : [r.cr406_brugeradresse, r.cr406_brugerpostnummer];
  if (normAdr(adr) !== a.norm) return false;
  const p = String(pn ?? "").replace(/[^0-9]/g, "");
  return !p || !a.postnr || p === a.postnr;
}

module.exports = async function (context, req) {
  try {
    const chrList = parseChrList(req.query.chr);
    const adrList = parseAdrList(req.query.adr);
    if (!chrList.length && !adrList.length) return json(context, 200, { chr: [], besaetninger: [] });

    const resource = dvUrl();
    const table = process.env.CHR_TABLE_PLURAL || "cr406_chrdatas";
    const token = await getToken(resource);

    // cr406_chr er tekst i Dataverse; hvis kolonnen skulle være et tal,
    // afviser Dataverse den citerede filter med 400 - så prøves uden citationstegn.
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json;odata.metadata=none",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0"
    };
    const query = quoted => {
      const filter = chrList.map(c => quoted ? `cr406_chr eq '${c}'` : `cr406_chr eq ${c}`).join(" or ");
      return fetch(
        `${resource}/api/data/v9.2/${table}` +
        `?$select=${FIELDS.join(",")}&$filter=${encodeURIComponent(filter)}&$orderby=cr406_chr asc`,
        { headers }
      );
    };

    const byChr = new Map();   // cr406_chr -> rå række (dubletter fjernes)
    const add = (list) => { for (const row of list) byChr.set(String(row.cr406_chr || ""), row); };

    if (chrList.length) {
      let r = await query(true);
      if (r.status === 400) r = await query(false);
      const txt = await r.text();
      if (!r.ok) throw new Error(`dv_error ${r.status}: ${txt.slice(0, 300)}`);
      add(JSON.parse(txt).value || []);
    }

    // Opslag på kundens adresser: vejnavn (startswith) + postnr. i Dataverse,
    // derefter eksakt match på vej + husnr. her. Postnr. kan være tekst eller
    // tal i tabellen - afviser Dataverse den citerede filter, prøves uden.
    if (adrList.length) {
      const adrQuery = quoted => {
        const pn = p => quoted ? `'${p}'` : p;
        const parts = adrList.map(a => {
          const vej = odataStr(a.vej);
          const e = `startswith(cr406_ejendomadresse,'${vej}')` + (a.postnr ? ` and cr406_ejendompostnr eq ${pn(a.postnr)}` : "");
          const b = `startswith(cr406_brugeradresse,'${vej}')` + (a.postnr ? ` and cr406_brugerpostnummer eq ${pn(a.postnr)}` : "");
          return `(${e}) or (${b})`;
        });
        return fetch(
          `${resource}/api/data/v9.2/${table}` +
          `?$select=${FIELDS.join(",")}&$filter=${encodeURIComponent(parts.join(" or "))}&$top=200`,
          { headers }
        );
      };
      try {
        let r = await adrQuery(true);
        if (r.status === 400) r = await adrQuery(false);
        const txt = await r.text();
        if (!r.ok) throw new Error(`dv_error ${r.status}: ${txt.slice(0, 300)}`);
        add((JSON.parse(txt).value || []).filter(row => adrList.some(a => rowMatchesAdr(row, a))));
      } catch (e) {
        // Adresseopslaget må ikke vælte CHR-opslaget
        context.log.warn("kunde-salmonella: adresseopslag fejlede", e.message);
      }
    }

    const rows = [...byChr.values()].map(mapRow).sort((a, b) => String(a.chr).localeCompare(String(b.chr)));
    json(context, 200, { chr: chrList, besaetninger: rows });
  } catch (e) {
    context.log.error("kunde-salmonella error", e);
    json(context, e.status || 500, { error: e.message });
  }
};



