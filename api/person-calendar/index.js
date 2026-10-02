// api/person-calendar/index.js
//
// Kalender for én medarbejder på én dag til "Kalender"-fanen i herrup.html.
//
//   GET /api/person-calendar?user=<entra-id>&date=YYYY-MM-DD   (date valgfri = i dag)
//
// Returnerer KUN tidspunkter, status (optaget/foreløbig/fraværende ...) og
// kategorier med farver - aldrig emne, sted, deltagere eller brødtekst.
// Er et møde markeret "Privat", fjernes kategorierne også.
//
// Adgang: alle der er logget ind på portalen (route-reglen "/*" kræver
// authenticated). Personen skal være medlem af "Alle - lely center herrup",
// ligesom i /api/entra-user.
//
// Kræver Graph application-tilladelsen Calendars.Read (eller ReadBasic) på
// app-registreringen bag DV_CLIENT_ID. Kategoriernes farver læses med
// MailboxSettings.Read - mangler den, får kategorierne en fast farve ud fra
// navnet i stedet.

const fetch = globalThis.fetch;

const GROUP_NAME = "Alle - lely center herrup";
const GRAPH = "https://graph.microsoft.com/v1.0";
const TZ = "Europe/Copenhagen";

// Outlook's faste kategorifarver (preset0-24)
const PRESET_COLORS = {
  preset0: "#e74856", preset1: "#ff8c00", preset2: "#ab620d", preset3: "#fff100",
  preset4: "#47d041", preset5: "#30c6cc", preset6: "#73aa24", preset7: "#4f6bed",
  preset8: "#8764b8", preset9: "#ee5fb7", preset10: "#7f98a6", preset11: "#4a5a66",
  preset12: "#a0a0a0", preset13: "#5c5c5c", preset14: "#2b2b2b", preset15: "#a4262c",
  preset16: "#ca5010", preset17: "#8e562e", preset18: "#c19c00", preset19: "#107c10",
  preset20: "#038387", preset21: "#498205", preset22: "#2e3c9e", preset23: "#5c2e91",
  preset24: "#b4009e"
};
const FALLBACK_PALETTE = ["#4f6bed", "#e74856", "#47d041", "#ff8c00", "#8764b8", "#30c6cc", "#c19c00", "#ee5fb7", "#038387", "#ca5010"];

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body };
}

module.exports = async function (context, req) {
  try {
    const userId = String(req.query?.user || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json(context, 400, { error: "Ugyldigt eller manglende user-id." });

    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.date || "") ? req.query.date : todayLocal();

    const token = await getGraphToken();

    // Samme sikkerhedstjek som /api/entra-user: kun medarbejdere i "Alle"-gruppen
    const groupId = await findGroupId(token, GROUP_NAME);
    if (!(await isGroupMember(token, userId, groupId))) {
      return json(context, 404, { error: "Medarbejderen blev ikke fundet." });
    }

    const start = withOffset(`${date}T00:00:00`);
    const end = withOffset(`${addDays(date, 1)}T00:00:00`);

    const url =
      `${GRAPH}/users/${encodeURIComponent(userId)}/calendarView` +
      `?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}` +
      `&$select=start,end,isAllDay,showAs,categories,sensitivity,isCancelled&$orderby=start/dateTime&$top=200`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${TZ}"` } });
    const j = await r.json();
    if (!r.ok) {
      if (r.status === 403) {
        return json(context, 403, { error: "Portalen har ikke adgang til kalendere (Graph-tilladelsen Calendars.Read mangler)." });
      }
      throw new Error(j.error?.message || `graph_error ${r.status}`);
    }

    const colors = await getCategoryColors(token, userId);

    const events = (j.value || [])
      .filter(e => e.isCancelled !== true)
      .map(e => {
        const isPrivate = e.sensitivity === "private" || e.sensitivity === "confidential";
        const cats = isPrivate ? [] : (e.categories || []);
        return {
          start: localIso(e.start?.dateTime),
          end: localIso(e.end?.dateTime),
          isAllDay: e.isAllDay === true,
          showAs: e.showAs || "busy",
          isPrivate,
          categories: cats.map(name => ({ name, color: colors?.[name.toLowerCase()] || fallbackColor(name) }))
        };
      })
      .filter(e => e.start && e.end);

    return json(context, 200, { date, events, categoryColorsFromOutlook: !!colors });
  } catch (e) {
    context.log("PERSON-CALENDAR ERROR", e.message);
    return json(context, 500, { error: "Kunne ikke hente kalenderen.", details: e.message });
  }
};

// ============ Hjælpere ============

async function getGraphToken() {
  const tenant = process.env.DV_TENANT_ID, clientId = process.env.DV_CLIENT_ID, clientSecret = process.env.DV_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) throw new Error("Manglende miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID eller DV_CLIENT_SECRET");
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default" })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

async function findGroupId(token, name) {
  const filter = encodeURIComponent(`displayName eq '${name.replace(/'/g, "''")}'`);
  const r = await fetch(`${GRAPH}/groups?$filter=${filter}&$select=id&$count=true`, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" }
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `graph_error ${r.status}`);
  if (!j.value?.length) throw new Error(`Gruppe ikke fundet: "${name}"`);
  return j.value[0].id;
}

async function isGroupMember(token, userId, groupId) {
  try {
    const r = await fetch(`${GRAPH}/users/${encodeURIComponent(userId)}/checkMemberGroups`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds: [groupId] })
    });
    const j = await r.json();
    return r.ok && Array.isArray(j.value) && j.value.includes(groupId);
  } catch {
    return false;
  }
}

// Personens egne kategorier med Outlook-farver. null hvis tilladelsen mangler.
async function getCategoryColors(token, userId) {
  try {
    const r = await fetch(`${GRAPH}/users/${encodeURIComponent(userId)}/outlook/masterCategories`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return null;
    const j = await r.json();
    const map = {};
    for (const c of j.value || []) {
      if (c.displayName && PRESET_COLORS[c.color]) map[c.displayName.toLowerCase()] = PRESET_COLORS[c.color];
    }
    return map;
  } catch {
    return null;
  }
}

function fallbackColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

function pad(n) { return String(n).padStart(2, "0"); }
function todayLocal() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
// "2026-10-02T00:00:00" (dansk tid) -> "2026-10-02T00:00:00+02:00"
function withOffset(local) {
  const [d, t] = local.split("T");
  const [y, m, dd] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, dd, h, mi) - 60 * 60000);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(probe).find(p => p.type === "timeZoneName")?.value || "GMT+01:00";
  const off = name === "GMT" ? "+00:00" : name.replace("GMT", "");
  return `${local.slice(0, 19)}${off}`;
}
function localIso(dt) {
  const s = String(dt || "");
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) + ":00" : "";
}
