// api/department-calendar/index.js
//
// Ledig/optaget-oversigt for en hel afdeling til "Afdeling"-fanen i herrup.html.
//
//   GET /api/department-calendar?user=<entra-id>&date=YYYY-MM-DD   (date valgfri = i dag)
//
// Finder personens afdeling (Entra "department") og alle aktive kolleger i
// "Alle - lely center herrup" med samme afdeling. Henter deres free/busy via
// Graph getSchedule i halvtimes-intervaller 07-17.
//
// Returnerer KUN en statuskode pr. halve time - aldrig emner, tider på møder,
// kategorier eller andet:
//   0 = ledig, 1 = foreløbig, 2 = optaget, 3 = fraværende, 4 = arbejder andetsteds
// (frontend samler 1/2/3 til "optaget")
//
// Adgang: alle der er logget ind på portalen (route-reglen "/*" kræver
// authenticated). Personen skal være medlem af "Alle"-gruppen, ligesom i
// /api/person-calendar. Bruger samme app-registrering (DV_CLIENT_ID) og
// Graph-tilladelsen Calendars.Read, som Kalender-fanen allerede kører på.

const fetch = globalThis.fetch;

const GROUP_NAME = "Alle - lely center herrup";
const GRAPH = "https://graph.microsoft.com/v1.0";
const WIN_TZ = "Romance Standard Time";   // Europe/Copenhagen i Windows-navn
const TZ = "Europe/Copenhagen";
const START_HOUR = 7;
const END_HOUR = 17;
const STEP_MIN = 30;
const CHUNK = 20;                          // personer pr. getSchedule-kald
const MEMBERS_CACHE_MS = 10 * 60 * 1000;

let tokenCache = null;   // { token, exp }
let groupIdCache = null;
let membersCache = null; // { at, list }

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body };
}

module.exports = async function (context, req) {
  try {
    const userId = String(req.query?.user || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json(context, 400, { error: "Ugyldigt eller manglende user-id." });

    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.date || "") ? req.query.date : todayLocal();

    const token = await getGraphToken();
    const members = await getMembers(token);

    const target = members.find(m => m.id.toLowerCase() === userId.toLowerCase());
    if (!target) return json(context, 404, { error: "Medarbejderen blev ikke fundet." });

    const department = (target.department || "").trim();
    if (!department) {
      return json(context, 200, { date, department: "", startHour: START_HOUR, endHour: END_HOUR, stepMin: STEP_MIN, people: [] });
    }

    const colleagues = members
      .filter(m => (m.department || "").trim().toLowerCase() === department.toLowerCase())
      .filter(m => m.accountEnabled !== false && (m.mail || m.userPrincipalName))
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "da"));

    const slots = ((END_HOUR - START_HOUR) * 60) / STEP_MIN;
    const views = new Map(); // mail(lowercase) -> { view, error }

    for (let i = 0; i < colleagues.length; i += CHUNK) {
      const part = colleagues.slice(i, i + CHUNK);
      const mails = part.map(m => (m.mail || m.userPrincipalName).toLowerCase());
      const r = await fetch(`${GRAPH}/users/${encodeURIComponent(userId)}/calendar/getSchedule`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: `outlook.timezone="${WIN_TZ}"` },
        body: JSON.stringify({
          schedules: mails,
          startTime: { dateTime: `${date}T${pad(START_HOUR)}:00:00`, timeZone: WIN_TZ },
          endTime:   { dateTime: `${date}T${pad(END_HOUR)}:00:00`,   timeZone: WIN_TZ },
          availabilityViewInterval: STEP_MIN
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 403) {
          return json(context, 403, { error: "Portalen har ikke adgang til kalendere (Graph-tilladelsen Calendars.Read mangler)." });
        }
        throw new Error(j.error?.message || `graph_error ${r.status}`);
      }
      for (const s of j.value || []) {
        const key = String(s.scheduleId || "").toLowerCase();
        const view = String(s.availabilityView || "");
        views.set(key, {
          view: s.error ? "" : view.padEnd(slots, "0").slice(0, slots),
          error: s.error ? "Kalender ikke tilgængelig" : ""
        });
      }
    }

    const people = colleagues.map(m => {
      const v = views.get((m.mail || m.userPrincipalName).toLowerCase()) || { view: "", error: "Kalender ikke tilgængelig" };
      return { id: m.id, name: m.displayName || m.mail, jobTitle: m.jobTitle || "", view: v.view, error: v.error };
    });

    return json(context, 200, { date, department, startHour: START_HOUR, endHour: END_HOUR, stepMin: STEP_MIN, people });
  } catch (e) {
    context.log("DEPARTMENT-CALENDAR ERROR", e.message);
    return json(context, 500, { error: "Kunne ikke hente afdelingens kalendere.", details: e.message });
  }
};

// ============ Hjælpere ============

async function getGraphToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const tenant = process.env.DV_TENANT_ID, clientId = process.env.DV_CLIENT_ID, clientSecret = process.env.DV_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) throw new Error("Manglende miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID eller DV_CLIENT_SECRET");
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default" })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

async function findGroupId(token) {
  if (groupIdCache) return groupIdCache;
  const filter = encodeURIComponent(`displayName eq '${GROUP_NAME.replace(/'/g, "''")}'`);
  const r = await fetch(`${GRAPH}/groups?$filter=${filter}&$select=id&$count=true`, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" }
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `graph_error ${r.status}`);
  if (!j.value?.length) throw new Error(`Gruppe ikke fundet: "${GROUP_NAME}"`);
  groupIdCache = j.value[0].id;
  return groupIdCache;
}

// Alle brugere i "Alle"-gruppen (caches i 10 min pr. function-instans)
async function getMembers(token) {
  if (membersCache && Date.now() - membersCache.at < MEMBERS_CACHE_MS) return membersCache.list;
  const groupId = await findGroupId(token);
  // transitiveMembers - gruppen indeholder undergrupper (samme som /api/entra-users)
  let url = `${GRAPH}/groups/${groupId}/transitiveMembers/microsoft.graph.user` +
    `?$select=id,displayName,department,jobTitle,mail,userPrincipalName,accountEnabled&$top=100`;
  const list = [];
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `graph_error ${r.status}`);
    list.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  membersCache = { at: Date.now(), list };
  return list;
}

function pad(n) { return String(n).padStart(2, "0"); }
function todayLocal() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
