// api/tips/index.js
//
// Henter den aktuelle "nyhed" (hvis der findes en ikke-udløbet) eller
// ellers et tilfældigt "tip", til visning i banneret på forsiden — i
// stedet for den statiske "Din hub til Web Apps, favoritter og
// værktøjer"-tekst.
//
// Tabel (i HerrupPortal-Dataverse-miljøet, peget ud af DV_HerrupPortal_URL):
//   Skemanavn: cr175_lch_tip   Sætnavn: cr175_lch_tips
//   cr175_lch_tipid       (primær nøgle)
//   cr175_lch_indhold     (tekst — selve teksten der vises)
//   cr175_lch_valg        (tekst — "Nyhed" eller "Tip")
//   cr175_lch_udlobsdato  (dato — kun relevant for Nyhed; er datoen passeret,
//                          regnes nyheden som udløbet, og der vises et tip i stedet)
//   cr175_lch_aktiv       (tekst — "Ja" eller "Nej")
//
// GET /api/tips → { type: "nyhed" | "tip" | null, indhold: string }
//
// Fejler noget her (manglende miljøvariabler, Dataverse nede, osv.), sender
// vi altid 200 med type:null — denne besked er ren dekoration på forsiden,
// og en fejl her skal ALDRIG vælte resten af siden.
//
// Miljøvariabler: DV_TENANT_ID, HerrupPortal_ClientID, HerrupPortal_ClientSecret, DV_HerrupPortal_URL

const fetch = globalThis.fetch;

const TABLE = "cr175_lch_tips";
const IDCOL = "cr175_lch_tipid";
const VALG_NYHED = 245500000;
const VALG_TIP = 245500001;

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

async function getDataverseToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.HerrupPortal_ClientID;
  const clientSecret = process.env.HerrupPortal_ClientSecret;
  const dvUrl        = process.env.DV_HerrupPortal_URL;

  if (!tenant || !clientId || !clientSecret || !dvUrl) {
    throw new Error("Manglende miljøvariabler til Dataverse");
  }

  const r = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         `${dvUrl}/.default`
      })
    }
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

module.exports = async function (context, req) {
  try {
    const token = await getDataverseToken();
    const dvUrl = process.env.DV_HerrupPortal_URL;

    const select = [IDCOL, "cr175_lch_indhold", "cr175_lch_valg", "cr175_lch_udlobsdato", "cr175_lch_aktiv", "createdon"].join(",");
    const filter = encodeURIComponent("cr175_lch_aktiv eq 'Ja'");
    const url = `${dvUrl}/api/data/v9.2/${TABLE}?$select=${select}&$filter=${filter}&$orderby=createdon desc`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json"
      }
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`dataverse_error ${r.status}: ${data.error?.message || JSON.stringify(data)}`);

    const rows = data.value || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Nyeste, ikke-udløbne "Nyhed" vinder altid.
    const nyhed = rows.find(row => {
      if (row.cr175_lch_valg !== VALG_NYHED) return false;
      const udlob = row.cr175_lch_udlobsdato ? new Date(row.cr175_lch_udlobsdato) : null;
      return !udlob || udlob >= today;
    });

    if (nyhed) {
      return json(context, 200, { type: "nyhed", indhold: nyhed.cr175_lch_indhold || "" });
    }

    // Ingen aktiv nyhed — vælg et tilfældigt tip blandt de aktive.
    const tips = rows.filter(row => row.cr175_lch_valg === VALG_TIP);
    if (tips.length) {
      const pick = tips[Math.floor(Math.random() * tips.length)];
      return json(context, 200, { type: "tip", indhold: pick.cr175_lch_indhold || "" });
    }

    return json(context, 200, { type: null, indhold: "" });
  } catch (e) {
    context.log("tips ERROR:", e.message);
    return json(context, 200, { type: null, indhold: "" });
  }
};
