// api/confirmbooking/index.js
//
// Bruges af selv-booking-flowet i select.html: klienten opretter allerede
// kalenderaftalen direkte mod Graph (uændret) - dette endpoint kalder den
// LIGE EFTER, udelukkende for at skrive statusrækken i Dataverse med det
// samme, så status-siden ikke skal vente på runbook'en (op til ~1 time).
//
// Rører IKKE kalenderen. Ingen rettighedskontrol udover at være logget ind -
// enhver bruger må bekræfte sin egen booking. Fejler kaldet, er det ikke
// kritisk: runbook'en retter statussen ved næste kørsel alligevel.
//
// Tokenet læses fra "X-Graph-Token" - IKKE "Authorization", som Azure Static
// Web Apps overskriver med sin egen interne token før kaldet når hertil (se
// bookdeskforother for samme problem/løsning). Uden denne rettelse endte
// "bookerName" altid som "Ukendt".

const TENANT_ID     = process.env.TenantID;
const CLIENT_ID     = process.env.ClientID;
const CLIENT_SECRET = process.env.ClientSecret;
const DATAVERSE_URL = String(process.env.DataverseUrl || "").replace(/\/$/, "");

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const ENTITY_SET = "cr6da_alleflyvebordes";

module.exports = async function (context, req) {
  try {
    const { deskId, slot, date } = req.body || {};
    const slotKey = String(slot || "").toLowerCase().trim();

    if (!deskId || !["am", "pm", "day"].includes(slotKey)) {
      return json(context, 400, { error: "Mangler eller ugyldige felter (deskId, slot)" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
      return json(context, 400, { error: "Ugyldig dato. Brug YYYY-MM-DD." });
    }

    // Hent bookerens navn til "by"-feltet - ikke en rettighedskontrol, bare
    // til visning/sporing og til senere annullering.
    const callerToken = extractCallerToken(req);

    let bookerName = "Ukendt";
    if (callerToken) {
      try {
        const caller = await graphGet(callerToken, `${GRAPH_ROOT}/me?$select=displayName,mail,userPrincipalName`);
        bookerName = caller.displayName || caller.mail || caller.userPrincipalName || bookerName;
      } catch {
        // Kunne ikke hente navn - fortsæt alligevel
      }
    }

    const dataverseToken = await getAppOnlyToken(`${DATAVERSE_URL}/.default`);
    const existing = await getExistingRow(dataverseToken, deskId, date);

    const amBooked  = existing?.cr6da_am === true || slotKey === "am" || slotKey === "day";
    const pmBooked  = existing?.cr6da_pm === true || slotKey === "pm" || slotKey === "day";
    const dayBooked = amBooked || pmBooked;

    // Kun det slot, der reelt blev booket, får sit "by"-felt sat - se
    // kommentar i toppen af filen.
    const amBy  = (slotKey === "am")  ? mergeNames(existing?.cr6da_amby, bookerName)  : (existing?.cr6da_amby  || "");
    const pmBy  = (slotKey === "pm")  ? mergeNames(existing?.cr6da_pmby, bookerName)  : (existing?.cr6da_pmby  || "");
    const dayBy = (slotKey === "day") ? mergeNames(existing?.cr6da_dayby, bookerName) : (existing?.cr6da_dayby || "");

    const body = {
      cr6da_deskid: deskId,
      cr6da_am: amBooked,
      cr6da_amby: amBy,
      cr6da_pm: pmBooked,
      cr6da_pmby: pmBy,
      cr6da_day: dayBooked,
      cr6da_dayby: dayBy,
      cr6da_eventcount: (existing?.cr6da_eventcount || 0) + 1,
      cr6da_date: date,
      cr6da_lastupdated: new Date().toISOString()
    };

    if (existing?.id) {
      await dataversePatch(dataverseToken, `${DATAVERSE_URL}/api/data/v9.2/${ENTITY_SET}(${existing.id})`, body);
    } else {
      await dataversePost(dataverseToken, `${DATAVERSE_URL}/api/data/v9.2/${ENTITY_SET}`, body);
    }

    return json(context, 200, { success: true });
  } catch (error) {
    context.log.error(error);
    return json(context, 500, { error: "Unhandled", details: error.message });
  }
};

// ============ Helpers ============

function extractCallerToken(req) {
  const custom = req.headers?.["x-graph-token"] || req.headers?.["X-Graph-Token"] || "";
  if (custom) return String(custom).trim();

  const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

async function getAppOnlyToken(scope) {
  const resp = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
      scope
    })
  });
  const text = await resp.text();
  const body = text ? JSON.parse(text) : {};
  if (!resp.ok || !body.access_token) throw new Error(`Token error for ${scope}: ${text}`);
  return body.access_token;
}

async function graphGet(token, url) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await resp.text();
  const body = text ? JSON.parse(text) : {};
  if (!resp.ok) throw new Error(`Graph GET ${resp.status}: ${text}`);
  return body;
}

async function getExistingRow(token, deskId, date) {
  const desk = deskId.replace(/'/g, "''");
  const d = date.replace(/'/g, "''");
  const filter = `cr6da_deskid eq '${desk}' and cr6da_date eq '${d}'`;
  const url =
    `${DATAVERSE_URL}/api/data/v9.2/${ENTITY_SET}` +
    `?$select=cr6da_alleflyvebordeid,cr6da_am,cr6da_amby,cr6da_pm,cr6da_pmby,cr6da_day,cr6da_dayby,cr6da_eventcount` +
    `&$filter=${encodeURIComponent(filter)}&$top=1`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;odata.metadata=none" }
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Dataverse GET ${resp.status}: ${text}`);
  const body = text ? JSON.parse(text) : {};
  const row = body.value?.[0];
  if (!row) return null;
  return { ...row, id: row.cr6da_alleflyvebordeid };
}

async function dataversePatch(token, url, body) {
  const resp = await fetch(url, { method: "PATCH", headers: dvHeaders(token), body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Dataverse PATCH ${resp.status}: ${await resp.text()}`);
}

async function dataversePost(token, url, body) {
  const resp = await fetch(url, { method: "POST", headers: dvHeaders(token), body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Dataverse POST ${resp.status}: ${await resp.text()}`);
}

function dvHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0"
  };
}

function mergeNames(existing, name) {
  const items = String(existing || "").split(";").map(s => s.trim()).filter(Boolean);
  if (!items.includes(name)) items.push(name);
  return items.sort().join("; ");
}

function json(context, status, body) {
  context.res = {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body
  };
}
