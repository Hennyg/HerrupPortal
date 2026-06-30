// api/employee-private/index.js
// Slår en bruger op i Dataverse-tabellen lch_medarbejdere (i miljøet DV_COREDATA)
// via lch_mail = mail/UPN.
//
// GET   /api/employee-private/{email}  → henter felter, filtreret af vises-flag
// PATCH /api/employee-private/{email}  → opdaterer felter — kun tilladt for
//        portal_admin ELLER hvis den indloggede bruger redigerer sig selv
//
// Default når en post oprettes/ikke findes: telefonVises og adresseVises = false (Nej),
// indtil medarbejderen selv (eller en admin) aktivt slår dem til.
//
// Miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET, DV_COREDATA

const fetch = globalThis.fetch;

const TABLE = "lch_medarbejdere";

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

// ── Roller + email fra x-ms-client-principal ─────────────────────────────────
function getRolesFromPrincipal(principal) {
  return [
    ...(principal.userRoles || []),
    ...(principal.claims || [])
      .filter(c => String(c.typ || "").toLowerCase() === "roles")
      .map(c => String(c.val || ""))
  ].map(r => String(r).toLowerCase());
}

function getEmailFromPrincipal(principal) {
  // userDetails er typisk UPN/mail ved Entra ID-login
  return (principal.userDetails || "").toLowerCase();
}

// ── Token til Dataverse ───────────────────────────────────────────────────────
async function getDataverseToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;
  const dvUrl         = process.env.DV_COREDATA;

  if (!tenant || !clientId || !clientSecret || !dvUrl) {
    throw new Error("Manglende miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET eller DV_COREDATA");
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

// ── Slå medarbejder op på lch_mail ────────────────────────────────────────────
async function findEmployeeByMail(token, dvUrl, email) {
  const fields = [
    "lch_medarbejderid",
    "lch_mail",
    "lch_privat_mail",
    "lch_privat_tlf",
    "lch_privat_Adresse",
    "lch_privat_postby",
    "lch_telefon_vises",
    "lch_adresse_vises"
  ].join(",");

  const filter = encodeURIComponent(`lch_mail eq '${email.replace(/'/g, "''")}'`);
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
    body: JSON.stringify({ lch_mail: email, ...fields })
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

// ── "Ja"/"Nej" konvertering ───────────────────────────────────────────────────
function toJaNej(boolVal) { return boolVal ? "Ja" : "Nej"; }
function fromJaNej(val) {
  // Ingen værdi i Dataverse = behandles som "Nej" (skjult), jf. ønsket default.
  if (val === null || val === undefined || val === "") return false;
  const v = String(val).trim().toLowerCase();
  return v === "ja" || v === "yes" || v === "true" || v === "1";
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  const principalB64 = req.headers["x-ms-client-principal"];
  if (!principalB64) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  let principal;
  try {
    principal = JSON.parse(Buffer.from(principalB64, "base64").toString("utf8"));
  } catch {
    return json(context, 401, { error: "Ugyldig principal" });
  }

  const email = decodeURIComponent(context.bindingData.email || "").trim();
  if (!email) {
    return json(context, 400, { error: "Mangler email-parameter" });
  }

  const dvUrl = process.env.DV_COREDATA;

  try {
    const token = await getDataverseToken();

    // ── GET: hent felter, filtreret af vises-flag ───────────────────────────
    if (req.method === "GET") {
      const emp = await findEmployeeByMail(token, dvUrl, email);

      if (!emp) {
        return json(context, 200, {
          found: false,
          privatMail: null, privatTlf: null, privatAdresse: null, privatPostby: null,
          telefonVises: false, adresseVises: false
        });
      }

      const telefonVises = fromJaNej(emp.lch_telefon_vises);
      const adresseVises = fromJaNej(emp.lch_adresse_vises);

      return json(context, 200, {
        found: true,
        privatMail:    emp.lch_privat_mail    || null,
        privatTlf:     telefonVises ? (emp.lch_privat_tlf || null) : null,
        privatAdresse: adresseVises ? (emp.lch_privat_Adresse || null) : null,
        privatPostby:  adresseVises ? (emp.lch_privat_postby  || null) : null,
        telefonVises,
        adresseVises
      });
    }

    // ── GET-RAW (intern brug): hent ufiltreret til redigeringsformular ───────
    if (req.method === "GET" && req.query && req.query.raw === "1") {
      // (dækket af blokken ovenfor — bevidst ikke separat gren, se note i frontend)
    }

    // ── PATCH: opdater eller opret — kun portal_admin eller "mig selv" ────────
    if (req.method === "PATCH") {
      const roles    = getRolesFromPrincipal(principal);
      const isAdmin  = roles.includes("portal_admin");
      const myEmail  = getEmailFromPrincipal(principal);
      const isSelf   = myEmail && myEmail === email.toLowerCase();

      if (!isAdmin && !isSelf) {
        return json(context, 403, { error: "Du kan kun redigere dine egne oplysninger" });
      }

      const body = req.body || {};
      const fields = {
        lch_privat_mail:    body.privatMail    ?? "",
        lch_privat_tlf:     body.privatTlf     ?? "",
        lch_privat_Adresse: body.privatAdresse ?? "",
        lch_privat_postby:  body.privatPostby  ?? "",
        lch_telefon_vises:  toJaNej(!!body.telefonVises),
        lch_adresse_vises:  toJaNej(!!body.adresseVises)
      };

      const existing = await findEmployeeByMail(token, dvUrl, email);
      if (existing) {
        await updateEmployee(token, dvUrl, existing.lch_medarbejderid, fields);
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
