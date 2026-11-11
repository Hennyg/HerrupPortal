// api/_medarbejder.js
// Fælles hjælpefunktioner til medarbejder-tabellen cr1eb_lch_medarbejderes
// i Dataverse-miljøet DV_COREDATA (samme tabel som /api/employee-private):
//   - Dataverse-token og opslag
//   - synlighed af helbred/kost (allergier, diabetes, andet)
//   - fødselsdage til "Velkommen"-tile'n på forsiden (/api/tips)
//
// Miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID, DV_CLIENT_SECRET, DV_COREDATA

const N = require("./_news");

const TABLE = "cr1eb_lch_medarbejderes";

// Kolonner i cr1eb_lch_medarbejderes
const F = {
  id:               "cr1eb_lch_medarbejdereid",
  mail:             "cr1eb_lch_mail",
  privatMail:       "cr1eb_lch_privat_mail",
  privatTlf:        "cr1eb_lch_privat_tlf",
  privatAdresse:    "cr1eb_lch_privat_adresse",
  privatPostby:     "cr1eb_lch_privat_postby",
  telefonVises:     "cr1eb_lch_telefon_vises",
  adresseVises:     "cr1eb_lch_adresse_vises",
  noedKontakter:    "cr1eb_lch_noedkontakter",
  noedSynlighed:    "cr1eb_lch_noed_synlighed",
  foto:             "cr1eb_lch_foto",
  // Nye kolonner (helbred/kost, fødselsdag, alternativ mail, TechID)
  allergier:        "cr1eb_lch_allergier",
  diabetes:         "cr1eb_lch_diabetes",
  helbredAndet:     "cr1eb_lch_helbred_andet",
  helbredSynlighed: "cr1eb_lch_helbred_synlighed",
  fodselsdag:       "cr1eb_lch_foedselsdag",
  fodselsdagVises:  "cr1eb_lch_foedselsdag_vises",
  altMail:          "cr1eb_lch_alt_mail",
  techId:           "cr1eb_lch_techid"
};

// ── Dataverse ───────────────────────────────────────────────────────────────
let tokenCache = { token: null, exp: 0 };

async function dvToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
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

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         `${dvUrl}/.default`
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  tokenCache = { token: j.access_token, exp: Date.now() + 50 * 60 * 1000 };
  return j.access_token;
}

function dvBase() {
  return `${String(process.env.DV_COREDATA || "").replace(/\/+$/, "")}/api/data/v9.2/`;
}

// Henter alle rækker (følger @odata.nextLink)
async function dvGetAll(path) {
  const token = await dvToken();
  let url = dvBase() + path.replace(/^\//, "");
  let rows = [];
  while (url) {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
        Prefer: "odata.maxpagesize=500"
      }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`dataverse_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
    rows = rows.concat(j.value || []);
    url = j["@odata.nextLink"] || null;
  }
  return rows;
}

// ── Ja/Nej-tekstfelter (samme konvention som telefon_vises/adresse_vises) ──
function toJaNej(boolVal) { return boolVal ? "Ja" : "Nej"; }
function fromJaNej(val) {
  if (val === null || val === undefined || val === "") return false;
  const v = String(val).trim().toLowerCase();
  return v === "ja" || v === "yes" || v === "true" || v === "1";
}

// ── Helbred/kost: synlighed ─────────────────────────────────────────────────
//   "leder" (standard): kun ledere (personer med medarbejdere under sig i
//                       Entra), portal_loen og admin – plus personen selv
//   "alle":             alle kolleger
const HELBRED_SYNLIGHED_VALUES = new Set(["leder", "alle"]);
const HELBRED_ROLES = ["portal_admin", "portal_herrup_portal_admin", "portal_loen"];

function helbredSynlighed(v) {
  return HELBRED_SYNLIGHED_VALUES.has(v) ? v : "leder";
}

// Har brugeren medarbejdere under sig i Entra?
async function isManager(graphToken, userId) {
  if (!userId) return false;
  try {
    const j = await N.graphJson(graphToken, `users/${userId}/directReports?$select=id&$top=1`);
    return (j.value || []).length > 0;
  } catch {
    return false;
  }
}

// Må den indloggede se helbred/kost, som er sat til "leder"?
async function viewerIsLeder(graphToken, userId, roles) {
  if ((roles || []).some(r => HELBRED_ROLES.includes(r))) return true;
  return isManager(graphToken, userId);
}

// ── Diabetes: "Type 1", "Type 2" eller tom ──────────────────────────────────
// Gamle værdier ("Ja" fra før typen kunne vælges) vises som "Ja (type ikke angivet)".
function diabetesValue(v) {
  const s = String(v || "").trim().toLowerCase().replace(/\s+/g, "");
  if (s === "type1" || s === "1") return "Type 1";
  if (s === "type2" || s === "2") return "Type 2";
  if (s === "ja" || s === "yes" || s === "true") return "Ja (type ikke angivet)";
  return "";
}
// Det der må gemmes: kun Type 1, Type 2 eller tom
function diabetesInput(v) {
  const d = diabetesValue(v);
  return d === "Type 1" || d === "Type 2" ? d : "";
}

// ── Fødselsdag (gemmes som tekst "ÅÅÅÅ-MM-DD") ────────────────────────────
function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
function monthDay(s) { return validDate(s) ? String(s).slice(5) : ""; }   // "MM-DD"

// Dagens dato i Danmark: { y, m, d, wd (0=søn … 5=fre), iso }
function cphToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short"
  }).formatToParts(now).map(p => [p.type, p.value]));
  const y = +parts.year, m = +parts.month, d = +parts.day;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { y, m, d, wd, iso: `${parts.year}-${parts.month}-${parts.day}` };
}

// "MM-DD" for dagen + offset dage
function mdPlus(t, offset) {
  const dt = new Date(Date.UTC(t.y, t.m - 1, t.d + offset, 12));
  return `${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

function joinNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`;
}

// Fødselsdage til forsiden. På en fredag tages lørdag og søndag med.
// Kun personer med en fødselsdag, hvor "vis tillykke" ikke er sat til Nej,
// og som er aktive i Entra. Huskes 10 min pr. dag.
let bdCache = { key: "", at: 0, items: [] };

async function birthdayItems(now = new Date()) {
  const t = cphToday(now);
  if (bdCache.key === t.iso && Date.now() - bdCache.at < 10 * 60 * 1000) return bdCache.items;

  const days = [{ offset: 0, label: "i dag" }];
  if (t.wd === 5) days.push({ offset: 1, label: "lørdag" }, { offset: 2, label: "søndag" });

  const filter = encodeURIComponent(`${F.fodselsdag} ne null`);
  const rows = await dvGetAll(`${TABLE}?$select=${F.mail},${F.fodselsdag},${F.fodselsdagVises}&$filter=${filter}`);

  let graphToken = null;
  const nameCache = new Map();
  async function nameFor(mail) {
    if (nameCache.has(mail)) return nameCache.get(mail);
    let name = null;
    try {
      graphToken = graphToken || await N.graphToken();
      const u = await N.graphJson(graphToken, `users/${encodeURIComponent(mail)}?$select=displayName,accountEnabled`);
      if (u.accountEnabled !== false) name = u.displayName || null;
    } catch { name = null; }
    nameCache.set(mail, name);
    return name;
  }

  const items = [];
  for (const day of days) {
    const md = mdPlus(t, day.offset);
    // 29. februar fejres den 28. februar i år, der ikke er skudår
    const dayDate = new Date(Date.UTC(t.y, t.m - 1, t.d + day.offset, 12));
    const extra = (md === "02-28" && !isLeapYear(dayDate.getUTCFullYear())) ? "02-29" : null;

    const hits = rows.filter(r => {
      if (String(r[F.fodselsdagVises] || "").trim().toLowerCase() === "nej") return false;
      const rmd = monthDay(r[F.fodselsdag]);
      return rmd && (rmd === md || rmd === extra);
    });
    const names = [];
    for (const r of hits) {
      const n = await nameFor(String(r[F.mail] || "").trim().toLowerCase());
      if (n) names.push(n);
    }
    if (!names.length) continue;
    names.sort((a, b) => a.localeCompare(b, "da"));

    items.push({
      id: `fodselsdag-${t.iso}-${day.offset}`,
      type: "fodselsdag",
      overskrift: day.offset === 0 ? "Tillykke med fødselsdagen! 🎉" : `Tillykke på ${day.label}! 🎉`,
      indhold: `${joinNames(names)} har fødselsdag ${day.offset === 0 ? "i dag" : `på ${day.label}`}.`,
      hasBody: false
    });
  }

  bdCache = { key: t.iso, at: Date.now(), items };
  return items;
}

module.exports = {
  TABLE, F,
  dvToken, dvBase, dvGetAll,
  toJaNej, fromJaNej,
  HELBRED_SYNLIGHED_VALUES, helbredSynlighed, viewerIsLeder,
  diabetesValue, diabetesInput,
  validDate, monthDay, birthdayItems
};
