// api/employee-private/index.js
// Slår en bruger op i Dataverse-tabellen lch_medarbejdere via lch_mail = mail/UPN
// og returnerer de private felter. Respekterer lch_telefon_vises og lch_adresse_vises:
// hvis "Nej", returneres feltet stadig men markeret som skjult i stedet for udeladt.
//
// Miljøvariabler (genbruger samme som øvrige Dataverse-kald i porten):
//   DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET, DV_URL  (fx https://orgXXXXXXXX.crm4.dynamics.com)

const fetch = globalThis.fetch;

const TABLE = "lch_medarbejdere"; // logisk entitetssæt-navn antages pluraliseret af Dataverse — se note nederst

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

// ── Token til Dataverse ───────────────────────────────────────────────────────
async function getDataverseToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;
  const dvUrl         = process.env.DV_URL;

  if (!tenant || !clientId || !clientSecret || !dvUrl) {
    throw new Error("Manglende miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET eller DV_URL");
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
    "lch_mail",
    "lch_privat_mail",
    "lch_privat_tlf",
    "lch_privat_Adresse",
    "lch_privat_postby",
    "lch_telefon_vises",
    "lch_adresse_vises",
    "lch_lelycenter_mail",
    "lch_arbejdsomrade"
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

// ── Tjek om et "vises"-felt er sat til Nej ────────────────────────────────────
// Disse felter er "Tekst på enkelt linje" ifølge skemaet, så værdien kan være
// "Nej" / "Ja", "0"/"1", "false"/"true" osv. afhængig af hvad der reelt er tastet ind.
function isHidden(val) {
  if (val === null || val === undefined || val === "") return false; // ingen data = ikke et "skjult" tilfælde, bare tomt
  const v = String(val).trim().toLowerCase();
  return v === "nej" || v === "no" || v === "false" || v === "0";
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  const email = decodeURIComponent(context.bindingData.email || "").trim();
  if (!email) {
    return json(context, 400, { error: "Mangler email-parameter" });
  }

  try {
    const dvUrl = process.env.DV_URL;
    const token = await getDataverseToken();
    const emp   = await findEmployeeByMail(token, dvUrl, email);

    if (!emp) {
      // Ingen post fundet i lch_medarbejdere — alle felter vises som "–"
      return json(context, 200, {
        found: false,
        privatMail:    null,
        privatTlf:     null,
        privatAdresse: null,
        privatPostby:  null,
        telefonVises:  true,
        adresseVises:  true
      });
    }

    const telefonVises  = !isHidden(emp.lch_telefon_vises);
    const adresseVises  = !isHidden(emp.lch_adresse_vises);

    return json(context, 200, {
      found: true,
      privatMail:    emp.lch_privat_mail    || null,
      privatTlf:     telefonVises ? (emp.lch_privat_tlf || null) : null,
      privatAdresse: adresseVises ? (emp.lch_privat_Adresse || null) : null,
      privatPostby:  adresseVises ? (emp.lch_privat_postby  || null) : null,
      telefonVises,
      adresseVises
    });
  } catch (e) {
    context.log("employee-private ERROR:", e.message);
    return json(context, 500, { error: e.message });
  }
};

// NOTE: Dataverse pluraliserer entitetssæt-navne automatisk for logiske navne der
// ikke allerede ender på 'er'/'es' osv. — "lch_medarbejdere" ender allerede på 'e'
// i flertal, så det er sandsynligvis korrekt som det står. Hvis API-kaldet fejler
// med 404, prøv "lch_medarbejderes" i stedet (Dataverse's default-pluraliseringsregel
// er at lægge 'es' til hvis navnet allerede ender på vokal).
