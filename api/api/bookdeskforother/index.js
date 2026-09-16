// api/bookdeskforother/index.js
//
// Lader medlemmer af BookForOthersGroupMail (eller portal_admin) booke et
// flyvebord PÅ VEGNE AF en anden bruger - aftalen oprettes i MODTAGERENS
// kalender via app-only Graph, ikke i den bookende brugers egen (det er den
// vigtigste forskel fra den almindelige klient-side booking, som kun kan
// skrive i /me/events).
//
// Sikkerhed: UI'en viser kun denne mulighed for medlemmer af gruppen, men det
// er kosmetisk. Denne funktion verificerer UAFHÆNGIGT:
//   1) hvem den kaldende bruger rent faktisk er (via deres EGET Graph-token,
//      som ikke kan forfalskes - vi slår IKKE en oid op som klienten sender)
//   2) at netop den bruger er medlem af BookForOthersGroupMail ELLER
//      Entra-gruppen "portal_admin"
// Ingen af delene stoler på noget klienten selv påstår.
//
// VIGTIGT om token-headeren: klienten sender IKKE tokenet i den almindelige
// "Authorization"-header. Azure Static Web Apps' linkede function-integration
// overskriver den header med sin egen interne SWA-token, før kaldet når frem
// hertil - det var årsagen til "Signing key is invalid" fra Graph (vi endte
// med at bruge SWA's eget token som om det var brugerens). Tokenet sendes
// derfor i stedet i "X-Graph-Token".
//
// Dataverse-skrivningen her bruger klassisk "GET eksisterende række, så
// PATCH/POST" (ikke native upsert via alternate key) - bevidst, fordi den
// optimering endnu ikke er rullet ud i miljøet.

const TENANT_ID         = process.env.TenantID;
const CLIENT_ID         = process.env.ClientID;
const CLIENT_SECRET     = process.env.ClientSecret;
const DATAVERSE_URL     = String(process.env.DataverseUrl || "").replace(/\/$/, "");
const DESK_GROUP_MAIL   = process.env.FlyvebordeGroupMail || "FlyvebordeAdgang@lcherrup.onmicrosoft.com";
const BFO_GROUP_MAIL    = process.env.BookForOthersGroupMail || "portal_flyveborde_bookforandre@lcherrup.dk";
// NB: Jeg kender ikke det faktiske mail-navn på "portal_admin"-gruppen - jeg
// gætter ud fra samme navnekonvention som de andre grupper. Ret via
// app-indstillingen "PortalAdminGroupMail" i Azure, hvis det ikke er rigtigt.
const ADMIN_GROUP_MAIL  = process.env.PortalAdminGroupMail || "portal_admin@lcherrup.dk";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const ENTITY_SET = "cr6da_alleflyvebordes";
const TZ         = "Europe/Copenhagen";

module.exports = async function (context, req) {
  try {
    const { deskId, slot, date, targetMail } = req.body || {};
    const slotKey = String(slot || "").toLowerCase().trim();

    if (!deskId || !targetMail || !["am", "pm", "day"].includes(slotKey)) {
      return json(context, 400, { error: "Mangler eller ugyldige felter (deskId, slot, targetMail)" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
      return json(context, 400, { error: "Ugyldig dato. Brug YYYY-MM-DD." });
    }

    // --- 1) Verificér den kaldende bruger via DERES EGET token ---
    const callerToken = extractCallerToken(req);
    if (!callerToken) {
      return json(context, 401, { error: "Mangler token (X-Graph-Token)" });
    }

    const caller = await graphGet(callerToken, `${GRAPH_ROOT}/me?$select=id,displayName,mail,userPrincipalName`);
    const callerOid = caller?.id;
    if (!callerOid) {
      return json(context, 401, { error: "Kunne ikke verificere brugeren" });
    }

    // --- 2) App-only token til retstjek, kalenderoprettelse og Dataverse ---
    const [graphAppToken, dataverseToken] = await Promise.all([
      getAppOnlyToken("https://graph.microsoft.com/.default"),
      getAppOnlyToken(`${DATAVERSE_URL}/.default`)
    ]);

    // --- 3) Er den kaldende bruger reelt medlem af "book for andre"-gruppen ELLER portal_admin? ---
    const [bfoGroupId, adminGroupId] = await Promise.all([
      findGroupId(graphAppToken, BFO_GROUP_MAIL),
      findGroupId(graphAppToken, ADMIN_GROUP_MAIL)
    ]);
    const candidateGroupIds = [bfoGroupId, adminGroupId].filter(Boolean);
    if (!candidateGroupIds.length || !(await isMemberOfAnyGroup(graphAppToken, callerOid, candidateGroupIds))) {
      return json(context, 403, { error: "Du har ikke rettighed til at booke flyveborde på vegne af andre." });
    }

    // --- 4) Find bordet (ressourcemailboks) ud fra deskId, ligesom /api/flyveborde ---
    const deskGroupId = await findGroupId(graphAppToken, DESK_GROUP_MAIL);
    if (!deskGroupId) {
      return json(context, 500, { error: `Adgangsgruppen '${DESK_GROUP_MAIL}' blev ikke fundet.` });
    }
    const resources = await getResourceMembers(graphAppToken, deskGroupId);
    const resource = resources.find(r => normalizeKey(r.deskId) === normalizeKey(deskId));
    if (!resource) {
      return json(context, 404, { error: `Flyvebordet '${deskId}' er ikke bookbart.` });
    }

    // --- 5) Find modtageren (targetMail skal være en gyldig postkasse) ---
    const target = await graphGet(
      graphAppToken,
      `${GRAPH_ROOT}/users/${encodeURIComponent(targetMail)}?$select=id,displayName,mail,userPrincipalName`
    ).catch(() => null);
    if (!target) {
      return json(context, 400, { error: `Kunne ikke finde modtageren '${targetMail}'.` });
    }
    const targetAddress = target.mail || target.userPrincipalName;
    const targetName = target.displayName || targetAddress;

    // --- 6) Hent evt. eksisterende Dataverse-række for bord+dato (fri-tjek + merge) ---
    const existing = await getExistingRow(dataverseToken, resource.deskId, date);

    if (slotKey === "am" && existing?.cr6da_am === true) {
      return json(context, 409, { error: `AM er allerede optaget for ${deskId} den ${date}.` });
    }
    if (slotKey === "pm" && existing?.cr6da_pm === true) {
      return json(context, 409, { error: `PM er allerede optaget for ${deskId} den ${date}.` });
    }
    if (slotKey === "day" && (existing?.cr6da_am === true || existing?.cr6da_pm === true)) {
      return json(context, 409, { error: `${deskId} er allerede delvist eller helt optaget den ${date}.` });
    }

    // --- 7) Opret kalenderaftalen i MODTAGERENS kalender (app-only) ---
    const times = slotToTimes(slotKey, date);
    const event = {
      subject: `Booking af ${deskId} (${slotKey.toUpperCase()}) – ${date}`,
      showAs: "free",
      location: { displayName: deskId },
      start: { dateTime: times.start, timeZone: TZ },
      end: { dateTime: times.end, timeZone: TZ },
      attendees: [{
        emailAddress: { address: resource.mail, name: deskId },
        type: "resource"
      }],
      body: {
        contentType: "HTML",
        content:
          `<div><b>Lokale:</b> ${escapeHtml(deskId)}</div>` +
          `<div><b>Dato:</b> ${escapeHtml(date)}</div>` +
          `<div><b>Slot:</b> ${escapeHtml(slotKey.toUpperCase())}</div>` +
          `<div><b>Booket af:</b> ${escapeHtml(caller.displayName || caller.mail || caller.userPrincipalName)} på vegne af ${escapeHtml(targetName)}</div>`
      }
    };

    await graphPost(graphAppToken, `${GRAPH_ROOT}/users/${encodeURIComponent(targetAddress)}/events`, event);

    // --- 8) Opdatér Dataverse med det samme (merge - overskriv ikke andre slots) ---
    const amBooked  = existing?.cr6da_am === true || slotKey === "am" || slotKey === "day";
    const pmBooked  = existing?.cr6da_pm === true || slotKey === "pm" || slotKey === "day";
    const dayBooked = amBooked || pmBooked;

    // NB: hver *by-kolonne opdateres KUN når det er netop dét slot der er
    // valgt - ikke ved "day" som tidligere krydsopdaterede amby/pmby/dayby
    // samtidig. Det er nødvendigt for at kunne vise "booket af" korrekt pr.
    // knap (en 7-16-booking skal kun vise navn under 7-16, ikke under 7-12
    // og 12-16 også) og for at kunne annullere den rigtige, enkelte booking.
    const amBy  = (slotKey === "am")  ? mergeNames(existing?.cr6da_amby, targetName)  : (existing?.cr6da_amby  || "");
    const pmBy  = (slotKey === "pm")  ? mergeNames(existing?.cr6da_pmby, targetName)  : (existing?.cr6da_pmby  || "");
    const dayBy = (slotKey === "day") ? mergeNames(existing?.cr6da_dayby, targetName) : (existing?.cr6da_dayby || "");

    const body = {
      cr6da_deskid: resource.deskId,
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

    return json(context, 200, {
      success: true,
      deskId: resource.deskId,
      slot: slotKey,
      date,
      bookedFor: targetName
    });

  } catch (error) {
    context.log.error(error);
    return json(context, 500, { error: "Unhandled", details: error.message });
  }
};

// ============ Helpers ============

// Læser brugerens Graph-token fra "X-Graph-Token" (primær vej, se kommentar
// øverst i filen). Falder tilbage til Authorization for det tilfælde at
// funktionen en dag kaldes uden om SWA (fx lokalt med func-core-tools), hvor
// Authorization-headeren rent faktisk kommer uændret igennem.
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

async function graphPost(token, url, payload) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Graph POST ${resp.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function findGroupId(token, groupMail) {
  const escaped = groupMail.replace(/'/g, "''");
  const url = `${GRAPH_ROOT}/groups?$select=id,mail&$filter=${encodeURIComponent(`mail eq '${escaped}'`)}`;
  const body = await graphGet(token, url);
  return body.value?.[0]?.id || null;
}

// Tjekker om brugeren er medlem af MINDST ÉN af de angivne grupper
// (checkMemberGroups accepterer flere group-id'er i samme kald).
async function isMemberOfAnyGroup(token, oid, groupIds) {
  const resp = await fetch(`${GRAPH_ROOT}/users/${encodeURIComponent(oid)}/checkMemberGroups`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ groupIds })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`checkMemberGroups ${resp.status}: ${text}`);
  const body = text ? JSON.parse(text) : {};
  return Array.isArray(body.value) && body.value.length > 0;
}

async function getResourceMembers(token, groupId) {
  let url = `${GRAPH_ROOT}/groups/${encodeURIComponent(groupId)}/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName&$top=999`;
  const members = [];
  while (url) {
    const page = await graphGet(token, url);
    if (Array.isArray(page.value)) members.push(...page.value);
    url = page["@odata.nextLink"] || "";
  }
  return members
    .map(m => {
      const mail = String(m.mail || m.userPrincipalName || "").trim();
      if (!mail || !mail.includes("@")) return null;
      return { id: m.id, displayName: m.displayName || mail, mail, deskId: mail.split("@")[0].trim() };
    })
    .filter(Boolean);
}

function normalizeKey(v) { return String(v || "").trim().toLowerCase(); }

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

function slotToTimes(slotKey, dateIso) {
  let start = "07:00:00", end = "16:00:00";
  if (slotKey === "am") end = "12:00:00";
  else if (slotKey === "pm") start = "12:00:00";
  return { start: `${dateIso}T${start}`, end: `${dateIso}T${end}` };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function json(context, status, body) {
  context.res = {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body
  };
}
