const fetch = globalThis.fetch;

const TABLE = "cr175_lch_tips";
const VALG_VALUES = { Nyhed: 245500000, Tip: 245500001 };

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

  const missing = [];
  if (!tenant) missing.push("DV_TENANT_ID");
  if (!clientId) missing.push("HerrupPortal_ClientID");
  if (!clientSecret) missing.push("HerrupPortal_ClientSecret");
  if (!dvUrl) missing.push("DV_HerrupPortal_URL");
  if (missing.length) throw new Error("Manglende miljøvariabler: " + missing.join(", "));

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

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error("Udløbsdato skal være i formatet YYYY-MM-DD");
  }
  return text;
}

module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) {
    return json(context, 401, { error: "Ikke logget ind" });
  }
  if ((req.method || "POST").toUpperCase() !== "POST") {
    return json(context, 405, { error: "method_not_allowed" });
  }

  try {
    const body = req.body || {};
    const overskrift = String(body.overskrift || "").trim();
    const indhold = String(body.indhold || "").trim();
    const valg = String(body.valg || "").trim();
    const aktiv = body.aktiv !== false;

    if (!overskrift) {
      return json(context, 400, { error: "missing_heading", message: "Overskrift må ikke være tom." });
    }
    if (!indhold) {
      return json(context, 400, { error: "missing_content", message: "Indhold må ikke være tomt." });
    }
    if (!new Set(["Nyhed", "Tip"]).has(valg)) {
      return json(context, 400, { error: "invalid_type", message: "Type skal være Nyhed eller Tip." });
    }

    let udlobsdato = null;
    try {
      udlobsdato = valg === "Nyhed" ? normalizeDate(body.udlobsdato) : null;
    } catch (e) {
      return json(context, 400, { error: "invalid_date", message: e.message });
    }

    const token = await getDataverseToken();
    const dvUrl = process.env.DV_HerrupPortal_URL;
    const payload = {
      cr175_lch_overskrift: overskrift,
      cr175_lch_indhold: indhold,
      cr175_lch_valg: VALG_VALUES[valg],
      cr175_lch_aktiv: aktiv ? "Ja" : "Nej"
    };
    if (udlobsdato) payload.cr175_lch_udlobsdato = udlobsdato;

    const r = await fetch(`${dvUrl}/api/data/v9.2/${TABLE}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!r.ok) {
      const message = data?.error?.message || text || `Dataverse returnerede ${r.status}`;
      context.log("tips-admin Dataverse fejl:", r.status, message);
      return json(context, 502, { error: "dataverse_error", message, status: r.status });
    }

    return json(context, 200, { ok: true, message: "Nyhed/tip er gemt." });
  } catch (e) {
    context.log("tips-admin ERROR:", e.message);
    return json(context, 500, { error: "tips_admin_failed", message: e.message });
  }
};
