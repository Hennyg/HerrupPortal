// api/favoritter/index.js
//
// Gemmer den enkelte brugers stjernemarkerede links ("Mine favoritter")
// centralt i Dataverse, så valget følger brugeren over på tværs af enheder
// (i stedet for kun at ligge lokalt i browseren på én maskine).
//
// Tabel (i HerrupPortal-Dataverse-miljøet, peget ud af DV_HerrupPortal_URL): cr175_lch_favoritter
//   Sætnavn (bruges i URL'en): cr175_lch_favoritters
//   cr175_lch_favoritterid  (primær nøgle, autogenereret af Dataverse)
//   cr175_lch_mail          (tekst — én række pr. bruger, lowercase mail/UPN)
//   cr175_lch_favoritjson   (tekst — JSON-array af portallink-id'er, fx ["guid1","guid2"])
//
// GET  /api/favoritter          → { ids: [...] } for den indloggede bruger
// PUT  /api/favoritter          → body { ids: [...] } — overskriver hele listen
// POST /api/favoritter          → samme som PUT (nogle klienter foretrækker POST)
//
// Miljøvariabler: DV_TENANT_ID, HerrupPortal_ClientID, HerrupPortal_ClientSecret, DV_HerrupPortal_URL

const fetch = globalThis.fetch;

const TABLE   = "cr175_lch_favoritters";
const IDCOL   = "cr175_lch_favoritterid";
const MAILCOL = "cr175_lch_mail";
const JSONCOL = "cr175_lch_favoritjson";

// Fornuftig øvre grænse — beskytter mod at et korrupt/ondsindet payload
// vokser JSON-feltet ubegrænset.
const MAX_IDS = 500;

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

// Samme mønster som resten af API'et: brugerens mail slås op direkte i
// x-ms-client-principal-headeren (base64-encoded JSON), uden Graph-kald.
function getPrincipal(req) {
  const b64 = req.headers["x-ms-client-principal"];
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function getDataverseToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.HerrupPortal_ClientID;
  const clientSecret = process.env.HerrupPortal_ClientSecret;
  const dvUrl        = process.env.DV_HerrupPortal_URL;

  const missing = [];
  if (!tenant)       missing.push("DV_TENANT_ID");
  if (!clientId)     missing.push("HerrupPortal_ClientID");
  if (!clientSecret) missing.push("HerrupPortal_ClientSecret");
  if (!dvUrl)        missing.push("DV_HerrupPortal_URL");
  if (missing.length) throw new Error("Manglende miljøvariabler: " + missing.join(", "));

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

async function findRowByMail(token, dvUrl, mail) {
  const filter = encodeURIComponent(`${MAILCOL} eq '${mail.replace(/'/g, "''")}'`);
  const url = `${dvUrl}/api/data/v9.2/${TABLE}?$select=${IDCOL},${MAILCOL},${JSONCOL}&$filter=${filter}&$top=1`;

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json"
    }
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`dataverse_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
  return (j.value && j.value[0]) || null;
}

async function createRow(token, dvUrl, mail, ids) {
  const r = await fetch(`${dvUrl}/api/data/v9.2/${TABLE}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ [MAILCOL]: mail, [JSONCOL]: JSON.stringify(ids) })
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`dataverse_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
  }
}

async function updateRow(token, dvUrl, recordId, ids) {
  const r = await fetch(`${dvUrl}/api/data/v9.2/${TABLE}(${recordId})`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ [JSONCOL]: JSON.stringify(ids) })
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`dataverse_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
  }
}

function parseIdsSafe(text) {
  try {
    const arr = JSON.parse(text || "[]");
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string" && x.trim()) : [];
  } catch {
    return [];
  }
}

module.exports = async function (context, req) {
  const principal = getPrincipal(req);
  if (!principal) return json(context, 401, { error: "Ikke logget ind" });

  const mail = (principal.userDetails || "").toLowerCase().trim();
  if (!mail) return json(context, 401, { error: "Ingen mail på brugeren" });

  const method = (req.method || "GET").toUpperCase();

  try {
    const token = await getDataverseToken();
    const dvUrl = process.env.DV_HerrupPortal_URL;

    if (method === "GET") {
      const row = await findRowByMail(token, dvUrl, mail);
      const ids = row ? parseIdsSafe(row[JSONCOL]) : [];
      return json(context, 200, { ids });
    }

    if (method === "PUT" || method === "POST") {
      const body = req.body || {};
      const ids = Array.isArray(body.ids)
        ? body.ids.filter(x => typeof x === "string" && x.trim()).slice(0, MAX_IDS)
        : [];

      const row = await findRowByMail(token, dvUrl, mail);
      if (row) {
        await updateRow(token, dvUrl, row[IDCOL], ids);
      } else {
        await createRow(token, dvUrl, mail, ids);
      }
      return json(context, 200, { ok: true, ids });
    }

    return json(context, 405, { error: "method_not_allowed" });
  } catch (e) {
    context.log("favoritter ERROR:", e.message);
    return json(context, 500, { error: e.message });
  }
};
