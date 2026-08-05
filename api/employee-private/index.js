// api/employee-private/index.js
// Slår en bruger op i Dataverse-tabellen cr1eb_lch_medarbejderes (i miljøet DV_COREDATA)
// via cr1eb_lch_mail = mail/UPN.
//
// GET   /api/employee-private/{email}  → henter felter, filtreret af vises-flag
// PATCH /api/employee-private/{email}  → opdaterer felter — kun tilladt for
//        portal_admin/portal_herrup_portal_admin ELLER hvis den indloggede
//        bruger redigerer sig selv
//
// Roller læses IKKE fra principal.claims (den er altid tom i Azure Functions-
// backend'en — kun /.auth/me fra browseren har den fulde claims-liste).
// Roller slås i stedet op direkte via Microsoft Graph (appRoleAssignments)
// mod login-app'en (AZURE_CLIENT_ID), med samme Graph-token som DV_CLIENT_ID
// allerede bruger til afdeling/chef/foto-opslag.
//
// Miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET, DV_COREDATA, AZURE_CLIENT_ID

const fetch = globalThis.fetch;

const TABLE = "cr1eb_lch_medarbejderes";

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

function getEmailFromPrincipal(principal) {
  return (principal.userDetails || "").toLowerCase();
}

// ── Microsoft Graph: token, roller, afdeling + chef-opslag ──────────────────
async function getGraphToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;

  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Manglende miljøvariabler til Graph: DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET");
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
        scope:         "https://graph.microsoft.com/.default"
      })
    }
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`graph_token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

// Slår login-app'ens (AZURE_CLIENT_ID) service principal op, inkl. dens App Roles.
// Bruges til at kunne oversætte et appRoleId til det læsbare rollenavn (fx "portal_admin").
async function getAppServicePrincipal(graphToken) {
  const clientId = process.env.AZURE_CLIENT_ID;
  if (!clientId) throw new Error("Manglende miljøvariabel: AZURE_CLIENT_ID");

  const r = await fetch(
    `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${clientId}'&$select=id,appId,appRoles`,
    { headers: { Authorization: `Bearer ${graphToken}` } }
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`graph_sp_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
  const sp = (j.value || [])[0];
  if (!sp) throw new Error("Service principal ikke fundet for AZURE_CLIENT_ID");
  return sp;
}

// Henter de portal_xxx-roller den indloggede bruger reelt har, via Graph
// (appRoleAssignments), i stedet for principal.claims (som er tom i backend).
async function getUserPortalRoles(graphToken, userId) {
  if (!userId) return [];
  try {
    const sp = await getAppServicePrincipal(graphToken);

    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/appRoleAssignments`,
      { headers: { Authorization: `Bearer ${graphToken}` } }
    );
    const j = await r.json();
    if (!r.ok) throw new Error(`graph_approles_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);

    const roleIdToValue = new Map((sp.appRoles || []).map(role => [role.id, String(role.value || "")]));

    return (j.value || [])
      .filter(a => a.resourceId === sp.id)
      .map(a => (roleIdToValue.get(a.appRoleId) || "").toLowerCase())
      .filter(Boolean);
  } catch (e) {
    // Fejler Graph-opslaget (rettigheder, netværk osv.), skal brugeren IKKE
    // automatisk regnes som admin — kun isSelf-vejen er tilgængelig da.
    return [];
  }
}

async function getUserDepartment(graphToken, email) {
  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=department`,
      { headers: { Authorization: `Bearer ${graphToken}` } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    return (j.department || "").trim() || null;
  } catch {
    return null;
  }
}

async function getUserManagerEmail(graphToken, email) {
  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/manager?$select=mail,userPrincipalName`,
      { headers: { Authorization: `Bearer ${graphToken}` } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    return (j.mail || j.userPrincipalName || "").toLowerCase() || null;
  } catch {
    return null;
  }
}

// Henter et skarpt 240x240-billede for ÉN specifik person — kun brugt til
// personkortet, hvor billedet vises i 80px. Undgår at gøre den samlede
// personliste (/api/entra-users) tung ved at hente det for alle på én gang.
async function getBigEntraPhoto(graphToken, email) {
  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photos/240x240/$value`,
      { headers: { Authorization: `Bearer ${graphToken}` } }
    );
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const ct  = r.headers.get("content-type") || "image/jpeg";
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

// Afgør om "myEmail" må se nødkontakterne for "email", givet det valgte synlighedsniveau.
// isAdmin/isSelf er allerede tjekket af den kaldende kode og giver altid adgang.
async function resolveNoedVisibility(context, { noedSynlighed, myEmail, myRoles, targetEmail, graphToken }) {
  if (noedSynlighed === "alle") {
    return true;
  }

  if (noedSynlighed === "afdeling") {
    try {
      const [myDept, targetDept] = await Promise.all([
        getUserDepartment(graphToken, myEmail),
        getUserDepartment(graphToken, targetEmail)
      ]);
      return !!myDept && !!targetDept && myDept.toLowerCase() === targetDept.toLowerCase();
    } catch (e) {
      context.log("Kunne ikke afgøre afdeling for nødkontakter:", e.message);
      return false;
    }
  }

  if (noedSynlighed === "loen_chef") {
    if (myRoles.includes("portal_loen")) {
      return true;
    }
    try {
      const managerEmail = await getUserManagerEmail(graphToken, targetEmail);
      return !!managerEmail && managerEmail === myEmail;
    } catch (e) {
      context.log("Kunne ikke afgøre chef for nødkontakter:", e.message);
      return false;
    }
  }

  // "ingen" eller ikke angivet: kun isSelf/isAdmin (håndteret af den kaldende kode)
  return false;
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
    "cr1eb_lch_adresse_vises",
    "cr1eb_lch_noedkontakter",
    "cr1eb_lch_noed_synlighed",
    "cr1eb_lch_foto"
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

const NOED_VISIBILITY_VALUES = new Set(["alle", "afdeling", "loen_chef", "ingen"]);

// Grænse for base64 data-URI længde på et uploadet billede (ca. 700 KB rå data).
// Sæt Dataverse-feltet cr1eb_lch_foto til "Multiple Lines of Text" med maks
// tilladt længde (helst 1.048.576 tegn) så det er plads til dette.
const MAX_PHOTO_LENGTH = 900000;

function parseNoedKontakter(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(c => ({
        navn:     String(c?.navn || "").trim(),
        relation: String(c?.relation || "").trim(),
        telefon:  String(c?.telefon || "").trim()
      }))
      .filter(c => c.navn || c.relation || c.telefon);
  } catch {
    return [];
  }
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

    // Én Graph-token bruges til både rolleopslag, afdeling/chef og foto.
    const graphToken = await getGraphToken();
    const roles      = await getUserPortalRoles(graphToken, principal.userId);
    const isAdmin     = roles.includes("portal_admin") || roles.includes("portal_herrup_portal_admin");
    const myEmail     = getEmailFromPrincipal(principal);
    const isSelf       = myEmail && myEmail === email.toLowerCase();

    if (req.method === "GET") {
      const emp = await findEmployeeByMail(token, dvUrl, email);

      if (!emp) {
        let bigPhoto = null;
        try {
          bigPhoto = await getBigEntraPhoto(graphToken, email);
        } catch (e) {
          context.log("Kunne ikke hente stort Entra-billede:", e.message);
        }

        return json(context, 200, {
          found: false,
          privatMail: null, privatTlf: null, privatAdresse: null, privatPostby: null,
          telefonVises: false, adresseVises: false,
          noedKontakter: [], noedSynlighed: "", noedVisibleToMe: true,
          bigPhoto, hasCustomPhoto: false
        });
      }

      const telefonVises = fromJaNej(emp.cr1eb_lch_telefon_vises);
      const adresseVises = fromJaNej(emp.cr1eb_lch_adresse_vises);

      const noedSynlighed = NOED_VISIBILITY_VALUES.has(emp.cr1eb_lch_noed_synlighed)
        ? emp.cr1eb_lch_noed_synlighed
        : "";
      const noedKontakterAll = parseNoedKontakter(emp.cr1eb_lch_noedkontakter);

      const noedVisibleToMe = isAdmin || isSelf || await resolveNoedVisibility(context, {
        noedSynlighed,
        myEmail,
        myRoles: roles,
        targetEmail: email,
        graphToken
      });

      // Skarpt billede til personkortet: brug det uploadede hvis der er et,
      // ellers hent en 240x240-udgave af Entra-billedet — kun for denne ene person.
      const hasCustomPhoto = !!emp.cr1eb_lch_foto;
      let bigPhoto = hasCustomPhoto ? emp.cr1eb_lch_foto : null;
      if (!bigPhoto) {
        try {
          bigPhoto = await getBigEntraPhoto(graphToken, email);
        } catch (e) {
          context.log("Kunne ikke hente stort Entra-billede:", e.message);
        }
      }

      return json(context, 200, {
        found: true,
        privatMail:    emp.cr1eb_lch_privat_mail    || null,
        privatTlf:     telefonVises ? (emp.cr1eb_lch_privat_tlf     || null) : null,
        privatAdresse: adresseVises ? (emp.cr1eb_lch_privat_adresse || null) : null,
        privatPostby:  adresseVises ? (emp.cr1eb_lch_privat_postby  || null) : null,
        telefonVises,
        adresseVises,
        noedKontakter:   noedVisibleToMe ? noedKontakterAll : [],
        noedSynlighed,
        noedVisibleToMe,
        bigPhoto,
        hasCustomPhoto
      });
    }

    if (req.method === "PATCH") {
      if (!isAdmin && !isSelf) {
        return json(context, 403, { error: "Du kan kun redigere dine egne oplysninger" });
      }

      const body = req.body || {};
      const fields = {};

      // Kun de felter der reelt er sendt med opdateres — undgår at et PATCH-kald
      // der f.eks. kun sender et nyt billede overskriver kontaktinfo/nødkontakter.
      if ("privatMail" in body)    fields.cr1eb_lch_privat_mail    = body.privatMail    ?? "";
      if ("privatTlf" in body)     fields.cr1eb_lch_privat_tlf     = body.privatTlf     ?? "";
      if ("privatAdresse" in body) fields.cr1eb_lch_privat_adresse = body.privatAdresse ?? "";
      if ("privatPostby" in body)  fields.cr1eb_lch_privat_postby  = body.privatPostby  ?? "";
      if ("telefonVises" in body)  fields.cr1eb_lch_telefon_vises  = toJaNej(!!body.telefonVises);
      if ("adresseVises" in body)  fields.cr1eb_lch_adresse_vises  = toJaNej(!!body.adresseVises);

      if ("noedKontakter" in body) {
        const noedKontakter = Array.isArray(body.noedKontakter)
          ? body.noedKontakter
              .map(c => ({
                navn:     String(c?.navn || "").trim(),
                relation: String(c?.relation || "").trim(),
                telefon:  String(c?.telefon || "").trim()
              }))
              .filter(c => c.navn || c.relation || c.telefon)
          : [];
        fields.cr1eb_lch_noedkontakter = JSON.stringify(noedKontakter);
      }

      if ("noedSynlighed" in body) {
        fields.cr1eb_lch_noed_synlighed = NOED_VISIBILITY_VALUES.has(body.noedSynlighed) ? body.noedSynlighed : "";
      }

      if ("customPhoto" in body) {
        const photo = body.customPhoto;
        if (photo === null || photo === "") {
          fields.cr1eb_lch_foto = "";
        } else if (typeof photo === "string") {
          if (!photo.startsWith("data:image/")) {
            return json(context, 400, { error: "Ugyldigt billedformat." });
          }
          if (photo.length > MAX_PHOTO_LENGTH) {
            return json(context, 400, { error: "Billedet er for stort. Prøv et mindre billede." });
          }
          fields.cr1eb_lch_foto = photo;
        } else {
          return json(context, 400, { error: "Ugyldigt billede." });
        }
      }

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
