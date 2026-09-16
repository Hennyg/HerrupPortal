// api/cancelbooking/index.js
//
// Lader medlemmer af BookForOthersGroupMail (eller portal_admin) annullere
// en eksisterende booking - både i bordets kalender og i den kaldendes egen
// kalender (uanset om det var en selv-booking eller en "book for andre").
//
// Hvorfor vi ikke bare kan slette ét bestemt event-ID:
//   Vi gemmer ikke noget Graph event-ID i Dataverse i dag - kun status
//   (ledig/optaget) og hvem der bookede ("by"-felterne). For at finde det
//   rigtige møde uden at ændre databasen bruger vi, at ethvert møde har et
//   FÆLLES "iCalUId" i alle de kalendere det optræder i (bordets og
//   bookerens), selvom selve event-ID'et er forskelligt i hver kalender:
//     1. Slå op i BORDETS kalender i det tidsrum, sloten dækker -> find
//        mødet, dets organizer og dets iCalUId.
//     2. Slå samme iCalUId op i ORGANIZERENS egen kalender -> find det
//        event-ID.
//     3. Slet organizerens event. Det afmelder automatisk bordet og sender
//        evt. aflysning til andre deltagere - vi behøver ikke selv holde
//        styr på to event-ID'er.
//
// Rettighedstjek er identisk med bookdeskforother: kaldende bruger
// verificeres via DERES EGET token (X-Graph-Token, ikke Authorization - se
// samme fil for hvorfor), og skal være medlem af BookForOthersGroupMail
// eller Entra-gruppen "portal_admin".

const TENANT_ID        = process.env.TenantID;
const CLIENT_ID        = process.env.ClientID;
const CLIENT_SECRET    = process.env.ClientSecret;
const DATAVERSE_URL    = String(process.env.DataverseUrl || "").replace(/\/$/, "");
const DESK_GROUP_MAIL  = process.env.FlyvebordeGroupMail || "FlyvebordeAdgang@lcherrup.onmicrosoft.com";
const BFO_GROUP_MAIL   = process.env.BookForOthersGroupMail || "portal_flyveborde_bookforandre@lcherrup.dk";
const ADMIN_GROUP_MAIL = process.env.PortalAdminGroupMail || "portal_admin@lcherrup.dk";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const ENTITY_SET = "cr6da_alleflyvebordes";
const TZ         = "Europe/Copenhagen";

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

    // --- 1) Verificér den kaldende bruger via DERES EGET token ---
    const callerToken = extractCallerToken(req);
    if (!callerToken) {
      return json(context, 401, { error: "Mangler token (X-Graph-Token)" });
    }
    const caller = await graphGet(callerToken, `${GRAPH_ROOT}/me?$select=id,displayName,mail,userPrincipalName`);
    if (!caller?.id) {
      return json(context, 401, { error: "Kunne ikke verificere brugeren" });
    }

    // --- 2) App-only token ---
    const [graphAppToken, dataverseToken] = await Promise.all([
      getAppOnlyToken("https://graph.microsoft.com/.default"),
      getAppOnlyToken(`${DATAVERSE_URL}/.default`)
    ]);

    // --- 3) Er den kaldende bruger reelt medlem af "book for andre" ELLER portal_admin? ---
    const [bfoGroupId, adminGroupId] = await Promise.all([
      findGroupId(graphAppToken, BFO_GROUP_MAIL),
      findGroupId(graphAppToken, ADMIN_GROUP_MAIL)
    ]);
    const candidateGroupIds = [bfoGroupId, adminGroupId].filter(Boolean);
    if (!candidateGroupIds.length || !(await isMemberOfAnyGroup(graphAppToken, caller.id, candidateGroupIds))) {
      return json(context, 403, { error: "Du har ikke rettighed til at annullere denne booking." });
    }

    // --- 4) Find bordets ressourcemailboks ---
    const deskGroupId = await findGroupId(graphAppToken, DESK_GROUP_MAIL);
    if (!deskGroupId) {
      return json(context, 500, { error: `Adgangsgruppen '${DESK_GROUP_MAIL}' blev ikke fundet.` });
    }
    const resources = await getResourceMembers(graphAppToken, deskGroupId);
    const resource = resources.find(r => normalizeKey(r.deskId) === normalizeKey(deskId));
    if (!resource) {
      return json(context, 404, { error: `Flyvebordet '${deskId}' findes ikke i adgangsgruppen.` });
    }

    // --- 5) Hent eksisterende Dataverse-række (skal findes, ellers er der intet at annullere) ---
    const existing = await getExistingRow(dataverseToken, resource.deskId, date);
    const isBooked =
      (slotKey === "am"  && existing?.cr6da_am  === true) ||
      (slotKey === "pm"  && existing?.cr6da_pm  === true) ||
      (slotKey === "day" && existing?.cr6da_day === true);
    if (!existing || !isBooked) {
      return json(context, 409, { error: `${deskId} er ikke booket for ${slotKey.toUpperCase()} den ${date}.` });
    }

    // --- 6) Find og slet mødet/møderne i bordets kalender for det tidsrum ---
    const times = slotToTimes(slotKey, date);
    const events = await getResourceEventsInWindow(graphAppToken, resource.mail, times.start, times.end);

    let cancelledCount = 0;
    const warnings = [];

    for (const ev of events) {
      try {
        await cancelByICalUId(graphAppToken, ev.organizerMail, ev.iCalUId, resource.mail, ev.resourceEventId);
        cancelledCount++;
      } catch (e) {
        warnings.push(`Kunne ikke annullere mødet fra ${ev.organizerMail || "ukendt"}: ${e.message}`);
      }
    }

    if (events.length === 0) {
      // Ingen kalenderaftale fundet (fx allerede slettet manuelt) - vi
      // renser stadig Dataverse-status, så UI'en ikke bliver hængende med
      // en booking, der reelt ikke findes længere.
      warnings.push("Ingen kalenderaftale fundet i det tidsrum - kun status blev ryddet.");
    }

    // --- 7) Ryd Dataverse-status for netop dette slot ---
    const clearedBody = buildClearedBody(existing, slotKey);
    await dataversePatch(dataverseToken, `${DATAVERSE_URL}/api/data/v9.2/${ENTITY_SET}(${existing.id})`, clearedBody);

    return json(context, 200, {
      success: true,
      deskId: resource.deskId,
      slot: slotKey,
      date,
      cancelledEvents: cancelledCount,
      warnings: warnings.length ? warnings : undefined
    });

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

async function graphGet(token, url, extraHeaders) {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(extraHeaders || {}) }
  });
  const text = await resp.text();
  const body = text ? JSON.parse(text) : {};
  if (!resp.ok) throw new Error(`Graph GET ${resp.status}: ${text}`);
  return body;
}

async function graphDelete(token, url) {
  const resp = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (resp.status !== 204 && !resp.ok) {
    const text = await resp.text();
    throw new Error(`Graph DELETE ${resp.status}: ${text}`);
  }
}

async function findGroupId(token, groupMail) {
  const escaped = groupMail.replace(/'/g, "''");
  const url = `${GRAPH_ROOT}/groups?$select=id,mail&$filter=${encodeURIComponent(`mail eq '${escaped}'`)}`;
  const body = await graphGet(token, url);
  return body.value?.[0]?.id || null;
}

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

// Henter møder i BORDETS kalender i det angivne tidsrum, og slår for hvert
// møde organizerens adresse + iCalUId op (nok til at finde og slette
// organizerens egen kopi bagefter).
async function getResourceEventsInWindow(token, resourceMail, startLocal, endLocal) {
  const url =
    `${GRAPH_ROOT}/users/${encodeURIComponent(resourceMail)}/calendarView` +
    `?startDateTime=${encodeURIComponent(startLocal)}&endDateTime=${encodeURIComponent(endLocal)}` +
    `&$select=id,subject,iCalUId,organizer`;

  const body = await graphGet(token, url, { Prefer: `outlook.timezone="${TZ}"` });
  const items = Array.isArray(body.value) ? body.value : [];

  return items.map(ev => ({
    resourceEventId: ev.id,
    iCalUId: ev.iCalUId,
    organizerMail: ev.organizer?.emailAddress?.address || null
  }));
}

// Finder og sletter organizerens EGEN kopi af mødet via det fælles
// iCalUId. Falder tilbage til at slette bordets egen kopi direkte, hvis
// organizerens kopi ikke kan findes (fx forladt/allerede fjernet konto) -
// så bordet i hvert fald bliver frigivet.
async function cancelByICalUId(token, organizerMail, iCalUId, resourceMail, resourceEventId) {
  if (organizerMail && iCalUId) {
    const url =
      `${GRAPH_ROOT}/users/${encodeURIComponent(organizerMail)}/events` +
      `?$select=id&$filter=${encodeURIComponent(`iCalUId eq '${iCalUId.replace(/'/g, "''")}'`)}`;
    const body = await graphGet(token, url).catch(() => null);
    const match = body?.value?.[0];
    if (match?.id) {
      await graphDelete(token, `${GRAPH_ROOT}/users/${encodeURIComponent(organizerMail)}/events/${match.id}`);
      return;
    }
  }
  // Fallback: slet bordets egen kopi direkte.
  await graphDelete(token, `${GRAPH_ROOT}/users/${encodeURIComponent(resourceMail)}/events/${resourceEventId}`);
}

function slotToTimes(slotKey, dateIso) {
  let start = "07:00:00", end = "16:00:00";
  if (slotKey === "am") end = "12:00:00";
  else if (slotKey === "pm") start = "12:00:00";
  return { start: `${dateIso}T${start}`, end: `${dateIso}T${end}` };
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

// Bygger den opdaterede Dataverse-krop, hvor kun det annullerede slot
// ryddes - de andre slots' status og "by"-felter rører vi ikke ved.
function buildClearedBody(existing, slotKey) {
  const am  = slotKey === "am"  ? false : existing.cr6da_am  === true;
  const pm  = slotKey === "pm"  ? false : existing.cr6da_pm  === true;
  const amby = slotKey === "am"  ? "" : (existing.cr6da_amby || "");
  const pmby = slotKey === "pm"  ? "" : (existing.cr6da_pmby || "");

  // "day" var én samlet booking, der dækkede begge halvdele - annulleres
  // den, ryddes am/pm/day samlet. Ellers er "day" bare den udledte
  // "hele dagen optaget"-status.
  const day  = slotKey === "day" ? false : (am || pm);
  const dayby = slotKey === "day" ? "" : (existing.cr6da_dayby || "");

  return {
    cr6da_am: slotKey === "day" ? false : am,
    cr6da_amby: slotKey === "day" ? "" : amby,
    cr6da_pm: slotKey === "day" ? false : pm,
    cr6da_pmby: slotKey === "day" ? "" : pmby,
    cr6da_day: day,
    cr6da_dayby: dayby,
    cr6da_eventcount: Math.max(0, (existing.cr6da_eventcount || 1) - 1),
    cr6da_lastupdated: new Date().toISOString()
  };
}

async function dataversePatch(token, url, body) {
  const resp = await fetch(url, { method: "PATCH", headers: dvHeaders(token), body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Dataverse PATCH ${resp.status}: ${await resp.text()}`);
}

function dvHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0"
  };
}

function json(context, status, body) {
  context.res = {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body
  };
}
