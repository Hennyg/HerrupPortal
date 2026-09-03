const fetch = globalThis.fetch;

const TABLE = "cr175_lch_tips";
const IDCOL = "cr175_lch_tipid";
const OVERSKRIFT_COL = "cr175_lch_overskrift";
const VALG_VALUES = { Nyhed: 245500000, Tip: 245500001 };
const VALG_NAMES = { 245500000: "Nyhed", 245500001: "Tip" };

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
  if (!r.ok || !data.access_token) throw new Error(`token_error ${r.status}: ${data.error_description || data.error || JSON.stringify(data)}`);
  return data.access_token;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Udløbsdato skal være i formatet YYYY-MM-DD");
  return text;
}

function activeText(value) {
  if (typeof value === "string") {
    return ["ja", "true", "1", "aktiv", "yes"].includes(value.trim().toLowerCase()) ? "Ja" : "Nej";
  }
  return value === false ? "Nej" : "Ja";
}

function activeBool(value) {
  return ["ja", "true", "1", "aktiv", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

async function dvRequest(token, dvUrl, path, options = {}) {
  const r = await fetch(`${dvUrl}/api/data/v9.2/${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const e = new Error(data?.error?.message || text || `Dataverse returnerede ${r.status}`);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

async function listRows(token, dvUrl, withHeading = true) {
  const cols = [IDCOL, "cr175_lch_indhold", "cr175_lch_valg", "cr175_lch_udlobsdato", "cr175_lch_aktiv", "createdon", "modifiedon"];
  if (withHeading) cols.splice(1, 0, OVERSKRIFT_COL);
  return dvRequest(token, dvUrl, `${TABLE}?$select=${cols.join(",")}&$orderby=createdon desc`);
}

function mapRow(row, headingSupported) {
  const valg = VALG_NAMES[row.cr175_lch_valg] || "Ukendt";
  return {
    id: row[IDCOL],
    overskrift: headingSupported ? (row[OVERSKRIFT_COL] || "") : "",
    indhold: row.cr175_lch_indhold || "",
    valg,
    udlobsdato: row.cr175_lch_udlobsdato ? String(row.cr175_lch_udlobsdato).slice(0, 10) : null,
    aktiv: activeBool(row.cr175_lch_aktiv),
    createdon: row.createdon || null,
    modifiedon: row.modifiedon || null
  };
}

function buildPayload(body, includeHeading = true) {
  const indhold = String(body.indhold || "").trim();
  const overskrift = String(body.overskrift || "").trim();
  const valg = String(body.valg || "").trim();
  if (!indhold) throw Object.assign(new Error("Indhold må ikke være tomt."), { userError: true });
  if (!Object.prototype.hasOwnProperty.call(VALG_VALUES, valg)) throw Object.assign(new Error("Type skal være Nyhed eller Tip."), { userError: true });

  const udlobsdato = valg === "Nyhed" ? normalizeDate(body.udlobsdato) : null;
  const payload = {
    cr175_lch_indhold: indhold,
    cr175_lch_valg: VALG_VALUES[valg],
    cr175_lch_aktiv: activeText(body.aktiv)
  };
  if (includeHeading) payload[OVERSKRIFT_COL] = overskrift;
  payload.cr175_lch_udlobsdato = udlobsdato;
  return payload;
}

module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) return json(context, 401, { error: "Ikke logget ind" });

  const method = (req.method || "GET").toUpperCase();
  try {
    const token = await getDataverseToken();
    const dvUrl = process.env.DV_HerrupPortal_URL;

    if (method === "GET") {
      let data;
      let headingSupported = true;
      try {
        data = await listRows(token, dvUrl, true);
      } catch (e) {
        if (e.status !== 400) throw e;
        headingSupported = false;
        data = await listRows(token, dvUrl, false);
      }
      return json(context, 200, {
        headingSupported,
        items: (data?.value || []).map(row => mapRow(row, headingSupported))
      });
    }

    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const body = req.body || {};
      const id = String(body.id || req.query?.id || "").trim();
      if (method !== "POST" && !id) return json(context, 400, { error: "missing_id", message: "Mangler id." });

      let headingSupported = true;
      let payload;
      try {
        payload = buildPayload(body, true);
        await dvRequest(token, dvUrl, method === "POST" ? TABLE : `${TABLE}(${id})`, {
          method: method === "POST" ? "POST" : "PATCH",
          body: payload
        });
      } catch (e) {
        if (e.userError) return json(context, 400, { error: "invalid_input", message: e.message });
        // Hvis overskrift-feltet ikke findes endnu, gem resten og informer frontend.
        if (e.status === 400 && payload && Object.prototype.hasOwnProperty.call(payload, OVERSKRIFT_COL)) {
          headingSupported = false;
          payload = buildPayload(body, false);
          await dvRequest(token, dvUrl, method === "POST" ? TABLE : `${TABLE}(${id})`, {
            method: method === "POST" ? "POST" : "PATCH",
            body: payload
          });
        } else {
          throw e;
        }
      }
      return json(context, 200, { ok: true, headingSupported, message: headingSupported ? "Gemt." : "Gemt, men overskrift-feltet findes ikke i Dataverse." });
    }

    if (method === "DELETE") {
      const id = String(req.query?.id || "").trim();
      if (!id) return json(context, 400, { error: "missing_id", message: "Mangler id." });
      await dvRequest(token, dvUrl, `${TABLE}(${id})`, { method: "DELETE" });
      return json(context, 200, { ok: true });
    }

    return json(context, 405, { error: "method_not_allowed" });
  } catch (e) {
    context.log("tips-admin ERROR:", e.message);
    return json(context, e.status && e.status < 500 ? e.status : 500, {
      error: "tips_admin_failed",
      message: e.message,
      status: e.status
    });
  }
};
