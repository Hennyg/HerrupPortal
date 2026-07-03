// api/employee-private/index.js
// Slår en bruger op i Dataverse-tabellen cr1eb_lch_medarbejderes (i miljøet DV_COREDATA)
// via cr1eb_lch_mail = mail/UPN.
//
// GET   /api/employee-private/{email}  → henter felter, filtreret af vises-flag
// PATCH /api/employee-private/{email}  → opdaterer felter — kun tilladt for
//        portal_admin ELLER hvis den indloggede bruger redigerer sig selv
//
// Miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET, DV_COREDATA

const fetch = globalThis.fetch;

const TABLE = "cr1eb_lch_medarbejderes";

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

function getRolesFromPrincipal(principal) {
  return [
    ...(principal.userRoles || []),
    ...(principal.claims || [])
      .filter(c => String(c.typ || "").toLowerCase() === "roles")
      .map(c => String(c.val || ""))
  ].map(r => String(r).toLowerCase());
}

function getEmailFromPrincipal(principal) {
  return (principal.userDetails || "").toLowerCase();
}

async function getDataverseToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;
  const dvUrl        = process.env.DV_COREDATA;

  const missing = [];
  if (!tenant)       missing.push("DV_TENANT_ID");
  if (!clientId)     missing.push("DV_CLIENT_ID");
  if (!clientSecret) missing.push("DV_CLIENT_SECRET");
  if (!dvUrl)        missing.push("DV_COREDATA");
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

async function findEmployeeByMail(token, dvUrl, email) {
  const fields = [
    "cr1eb_lch_medarbejdereid",
    "cr1eb_lch_mail",
    "cr1eb_lch_privat_mail",
    "cr1eb_lch_privat_tlf",
    "cr1eb_lch_privat_adresse",
    "cr1eb_lch_privat_postby",
    "cr1eb_lch_telefon_vises",
    "cr1eb_lch_adresse_vises"
  ].join(",");

  const filter = encodeURIComponent(`cr1eb_lch_mail eq '${email.replace(/'/g, "''")}'`);
  const url = `${dvUrl}/api/data/v9.2/${TABLE}?$select=${fields}&$filter=${filter}&$top=1`;

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

async function createEmployee(token, dvUrl, email, fields) {
  const r = await fetch(`${dvUrl}/api/data/v9.2/${TABLE}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ cr1eb_lch_mail: email, ...fields })
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`dataverse_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
  }
}

async function updateEmployee(token, dvUrl, recordId, fields) {
  const r = await fetch(`${dvUrl}/api/data/v9.2/${TABLE}(${recordId})`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(fields)
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`dataverse_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
  }
}

function toJaNej(boolVal) { return boolVal ? "Ja" : "Nej"; }
function fromJaNej(val) {
  if (val === null || val === undefined || val === "") return false;
  const v = String(val).trim().toLowerCase();
  return v === "ja" || v === "yes" || v === "true" || v === "1";
}

module.exports = async function (context, req) {
  const principalB64 = req.headers["x-ms-client-principal"];
  if (!principalB64) return json(context, 401, { error: "Ikke logget ind" });

  let principal;
  try {
    principal = JSON.parse(Buffer.from(principalB64, "base64").toString("utf8"));
  } catch {
    return json(context, 401, { error: "Ugyldig principal" });
  }

  const email = decodeURIComponent(context.bindingData.email || "").trim();
  if (!email) return json(context, 400, { error: "Mangler email-parameter" });

  const dvUrl = process.env.DV_COREDATA;

  try {
    const token = await getDataverseToken();

    if (req.method === "GET") {
      const emp = await findEmployeeByMail(token, dvUrl, email);

      if (!emp) {
        return json(context, 200, {
          found: false,
          privatMail: null, privatTlf: null, privatAdresse: null, privatPostby: null,
          telefonVises: false, adresseVises: false
        });
      }

      const telefonVises = fromJaNej(emp.cr1eb_lch_telefon_vises);
      const adresseVises = fromJaNej(emp.cr1eb_lch_adresse_vises);

      return json(context, 200, {
        found: true,
        privatMail:    emp.cr1eb_lch_privat_mail    || null,
        privatTlf:     telefonVises ? (emp.cr1eb_lch_privat_tlf     || null) : null,
        privatAdresse: adresseVises ? (emp.cr1eb_lch_privat_adresse || null) : null,
        privatPostby:  adresseVises ? (emp.cr1eb_lch_privat_postby  || null) : null,
        telefonVises,
        adresseVises
      });
    }

    if (req.method === "PATCH") {
      const roles   = getRolesFromPrincipal(principal);
      const isAdmin = roles.includes("portal_admin");
      const myEmail = getEmailFromPrincipal(principal);
      const isSelf  = myEmail && myEmail === email.toLowerCase();

      if (!isAdmin && !isSelf) {
        return json(context, 403, { error: "Du kan kun redigere dine egne oplysninger" });
      }

      const body = req.body || {};
      const fields = {
        cr1eb_lch_privat_mail:    body.privatMail    ?? "",
        cr1eb_lch_privat_tlf:     body.privatTlf     ?? "",
        cr1eb_lch_privat_adresse: body.privatAdresse ?? "",
        cr1eb_lch_privat_postby:  body.privatPostby  ?? "",
        cr1eb_lch_telefon_vises:  toJaNej(!!body.telefonVises),
        cr1eb_lch_adresse_vises:  toJaNej(!!body.adresseVises)
      };

      const existing = await findEmployeeByMail(token, dvUrl, email);
      if (existing) {
        await updateEmployee(token, dvUrl, existing.cr1eb_lch_medarbejdereid, fields);
      } else {
        await createEmployee(token, dvUrl, email, fields);
      }

      return json(context, 200, { success: true });
    }

    return json(context, 405, { error: "Metode ikke understøttet" });
  } catch (e) {
    context.log("employee-private ERROR:", e.message);
    return json(context, 500, { error: e.message });
  }
};
