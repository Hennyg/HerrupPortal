// api/tips/index.js
// Returnerer alle aktive og ikke-udløbne nyheder/tips til hero-rotationen.

const fetch = globalThis.fetch;

const TABLE = "cr175_lch_tips";
const IDCOL = "cr175_lch_tipid";
const VALG_NYHED = 245500000;
const VALG_TIP = 245500001;
const ACTIVE_TEXT = "Ja";

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body
  };
}

async function getDataverseToken() {
  const tenant = process.env.DV_TENANT_ID;
  const clientId = process.env.HerrupPortal_ClientID;
  const clientSecret = process.env.HerrupPortal_ClientSecret;
  const dvUrl = process.env.DV_HerrupPortal_URL;

  if (!tenant || !clientId || !clientSecret || !dvUrl) {
    throw new Error("Manglende miljøvariabler til Dataverse");
  }

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: `${dvUrl}/.default`
    })
  });

  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error(`token_error ${r.status}: ${data.error_description || data.error || JSON.stringify(data)}`);
  }
  return data.access_token;
}

function isNotExpired(row, now) {
  if (row.cr175_lch_valg !== VALG_NYHED) return true;
  if (!row.cr175_lch_udlobsdato) return true;
  const end = new Date(`${row.cr175_lch_udlobsdato}T23:59:59`);
  return !Number.isNaN(end.getTime()) && end >= now;
}

module.exports = async function (context, req) {
  try {
    const token = await getDataverseToken();
    const dvUrl = process.env.DV_HerrupPortal_URL;

    const select = [
      IDCOL,
      "cr175_lch_overskrift",
      "cr175_lch_indhold",
      "cr175_lch_valg",
      "cr175_lch_udlobsdato",
      "cr175_lch_aktiv",
      "createdon"
    ].join(",");

    const filter = encodeURIComponent(`cr175_lch_aktiv eq '${ACTIVE_TEXT}'`);
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
    if (!r.ok) {
      throw new Error(`dataverse_error ${r.status}: ${data.error?.message || JSON.stringify(data)}`);
    }

    const now = new Date();
    const items = (data.value || [])
      .filter(row => row.cr175_lch_valg === VALG_NYHED || row.cr175_lch_valg === VALG_TIP)
      .filter(row => isNotExpired(row, now))
      .filter(row => String(row.cr175_lch_indhold || "").trim())
      .map(row => ({
        id: row[IDCOL],
        type: row.cr175_lch_valg === VALG_NYHED ? "nyhed" : "tip",
        overskrift: String(row.cr175_lch_overskrift || "").trim() ||
          (row.cr175_lch_valg === VALG_NYHED ? "Nyhed" : "Tip"),
        indhold: String(row.cr175_lch_indhold || "").trim(),
        udlobsdato: row.cr175_lch_udlobsdato || null
      }));

    return json(context, 200, { items });
  } catch (e) {
    context.log("tips ERROR:", e.message);
    // Nyhed/tip må aldrig vælte forsiden.
    return json(context, 200, { items: [] });
  }
};
