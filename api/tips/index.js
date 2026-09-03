const fetch = globalThis.fetch;

const TABLE = "cr175_lch_tips";
const IDCOL = "cr175_lch_tipid";
const VALG_NYHED = 245500000;
const VALG_TIP = 245500001;
const OVERSKRIFT_COL = "cr175_lch_overskrift";

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
  if (!tenant || !clientId || !clientSecret || !dvUrl) throw new Error("Manglende miljøvariabler til Dataverse");

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
  if (!r.ok || !data.access_token) throw new Error(`token_error ${r.status}: ${data.error_description || data.error || JSON.stringify(data)}`);
  return data.access_token;
}

function isActive(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return ["ja", "true", "1", "aktiv", "yes"].includes(v);
}

function isNotExpired(row) {
  if (row.cr175_lch_valg !== VALG_NYHED) return true;
  if (!row.cr175_lch_udlobsdato) return true;
  const end = new Date(`${String(row.cr175_lch_udlobsdato).slice(0, 10)}T23:59:59`);
  return !Number.isNaN(end.getTime()) && end >= new Date();
}

async function getRows(token, dvUrl, withHeading) {
  const cols = [IDCOL, "cr175_lch_indhold", "cr175_lch_valg", "cr175_lch_udlobsdato", "cr175_lch_aktiv", "createdon"];
  if (withHeading) cols.splice(1, 0, OVERSKRIFT_COL);
  const url = `${dvUrl}/api/data/v9.2/${TABLE}?$select=${cols.join(",")}&$orderby=createdon desc`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json"
    }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`dataverse_error ${r.status}: ${data.error?.message || JSON.stringify(data)}`);
    e.status = r.status;
    throw e;
  }
  return data.value || [];
}

module.exports = async function (context) {
  try {
    const token = await getDataverseToken();
    const dvUrl = process.env.DV_HerrupPortal_URL;

    let rows;
    let headingSupported = true;
    try {
      rows = await getRows(token, dvUrl, true);
    } catch (e) {
      if (e.status !== 400) throw e;
      headingSupported = false;
      rows = await getRows(token, dvUrl, false);
    }

    const items = rows
      .filter(row => isActive(row.cr175_lch_aktiv) && isNotExpired(row))
      .filter(row => row.cr175_lch_valg === VALG_NYHED || row.cr175_lch_valg === VALG_TIP)
      .map(row => {
        const type = row.cr175_lch_valg === VALG_NYHED ? "nyhed" : "tip";
        return {
          id: row[IDCOL],
          type,
          overskrift: headingSupported && row[OVERSKRIFT_COL]
            ? row[OVERSKRIFT_COL]
            : (type === "nyhed" ? "Nyhed" : "Tip"),
          indhold: row.cr175_lch_indhold || "",
          udlobsdato: row.cr175_lch_udlobsdato || null
        };
      });

    return json(context, 200, { items });
  } catch (e) {
    context.log("tips ERROR:", e.message);
    // Forsiden må ikke vælte pga. banneret, men send debug-felt så fejlen kan ses i Network.
    return json(context, 200, { items: [], error: e.message });
  }
};
