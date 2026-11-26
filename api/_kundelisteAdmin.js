// api/_kundelisteAdmin.js
// Fælles hjælpefunktioner til Kundeliste-admin (kundeliste_admin.html):
//   - adgangstjek (portal_admin / portal_kundeliste_admin)
//   - kontraktfarver  (tabel lch_serviceaftaler_kontraktfarve)
//   - aftaletekster   (tabel lch_serviceaftaler_aftalertekst)
//   - serviceaftaler  (tabel lch_serviceaftaler) – oprettes fra kundeliste.html
//   - kolonnegrupper  (tabel lch_kundeliste_kolonnegruppe) – hvilke kolonner
//                     hver afdeling ser i kundelisten
//   - hjælpetekster   (tabel lch_kundeliste_hjaelpetekst) – forklaringer bag
//                     (?) ved kolonneoverskrifter og knapper i kundelisten
// Alle tabeller ligger i Kundeliste-miljøet (KL_DV_URL) – samme som kunder/produkter.

const N = require("./_news");
const crypto = require("crypto");
const { dvFetch, fetchAll } = require("./_dvKunde");

const ADMIN_ROLES = ["portal_admin", "portal_kundeliste_admin"];

// Tabeller i Kundeliste-miljøet. "set" er sætnavnet (EntitySetName), som
// bruges i URL'en. Mangler det, slås det op i Dataverse-metadata.
const T = {
  farve: {
    logical: "cr1eb_lch_serviceaftaler_kontraktfarve",
    set:     "cr1eb_lch_serviceaftaler_kontraktfarves",
    id:      "cr1eb_lch_serviceaftaler_kontraktfarveid"
  },
  aftaletekst: {
    logical: "cr1eb_lch_serviceaftaler_aftalertekst",
    set:     "cr1eb_lch_serviceaftaler_aftalerteksts",
    id:      "cr1eb_lch_serviceaftaler_aftalertekstid"
  },
  serviceaftale: {
    logical: "cr1eb_lch_serviceaftaler",
    set:     "cr1eb_lch_serviceaftalers",
    id:      "cr1eb_lch_serviceaftalerid"
  },
  kolonnegruppe: {
    logical: "cr1eb_lch_kundeliste_kolonnegruppe",
    set:     "cr1eb_lch_kundeliste_kolonnegruppes",
    id:      "cr1eb_lch_kundeliste_kolonnegruppeid"
  },
  hjaelp: {
    logical: "cr1eb_lch_kundeliste_hjaelpetekst",
    id:      "cr1eb_lch_kundeliste_hjaelpetekstid"
    // "set" slås op i metadata første gang
  },
  produkt: { set: "cr1eb_lch_kundeprodukts" }
};

// Navigationsegenskab for opslaget lch_vareopslag (→ aftaletekst)
const VAREOPSLAG_NAV = "cr1eb_lch_vareopslag";

const setCache = new Map();
async function entitySet(t) {
  if (t.set) return t.set;
  if (setCache.has(t.logical)) return setCache.get(t.logical);
  let set = `${t.logical}s`;
  try {
    const j = await dvFetch(`EntityDefinitions(LogicalName='${t.logical}')?$select=EntitySetName`);
    if (j?.EntitySetName) set = j.EntitySetName;
  } catch { /* fald tilbage til <logisk navn>s */ }
  setCache.set(t.logical, set);
  return set;
}

// ── Adgang ──────────────────────────────────────────────────────────────────
async function isKundelisteAdmin(req) {
  const me = N.getPrincipal(req);
  if (!me) return { me: null, admin: false };
  let roles = me.roles || [];
  try { roles = await N.lookupRoles(me); } catch { /* brug rollerne fra login */ }
  return { me, admin: roles.some(r => ADMIN_ROLES.includes(String(r).toLowerCase())) };
}

// ── Kontraktfarver ──────────────────────────────────────────────────────────
const HEX = /^#[0-9a-f]{6}$/i;

async function loadFarver() {
  const set = await entitySet(T.farve);
  const rows = await fetchAll(`${set}?$select=${T.farve.id},cr1eb_lch_name,cr1eb_lch_farve`);
  return rows
    .map(r => ({
      id: r[T.farve.id],
      kontrakt: String(r.cr1eb_lch_name || "").trim(),
      farve: HEX.test(String(r.cr1eb_lch_farve || "").trim()) ? String(r.cr1eb_lch_farve).trim().toLowerCase() : ""
    }))
    .filter(r => r.kontrakt);
}

// Kontrakttyper, der findes på aktive produkter, med antal produkter
async function kontraktTyper() {
  const rows = await fetchAll(`${T.produkt.set}?$select=cr1eb_lch_kontrakt&$filter=${encodeURIComponent("cr1eb_lch_aktiv eq true")}`);
  const antal = new Map();
  for (const r of rows) {
    const k = String(r.cr1eb_lch_kontrakt || "").trim();
    if (k) antal.set(k, (antal.get(k) || 0) + 1);
  }
  return antal;
}

async function saveFarve(kontrakt, farve) {
  kontrakt = String(kontrakt || "").trim();
  farve = String(farve || "").trim().toLowerCase();
  if (!kontrakt) throw Object.assign(new Error("Kontrakttype mangler"), { status: 400 });
  if (farve && !HEX.test(farve)) throw Object.assign(new Error(`Ugyldig farve: ${farve}`), { status: 400 });

  const set = await entitySet(T.farve);
  const existing = (await loadFarver()).find(r => r.kontrakt.toLowerCase() === kontrakt.toLowerCase());

  if (!farve) {                                        // tom farve = brug standard
    if (existing) await dvFetch(`${set}(${existing.id})`, { method: "DELETE" });
    return null;
  }
  if (existing) {
    await dvFetch(`${set}(${existing.id})`, { method: "PATCH", body: { cr1eb_lch_farve: farve } });
    return existing.id;
  }
  const created = await dvFetch(set, {
    method: "POST",
    body: { cr1eb_lch_name: kontrakt, cr1eb_lch_farve: farve },
    headers: { Prefer: "return=representation" }
  });
  return created?.[T.farve.id] || null;
}

// ── Aftaletekster ───────────────────────────────────────────────────────────
// cr1eb_lch_name (primær kolonne) er kun en teknisk nøgle. Den udfyldes
// automatisk ved oprettelse og vises/rettes ikke af brugeren.
const AFTALE_FIELDS = {
  varenr:      "cr1eb_lch_varenr",
  servicetype: "cr1eb_lch_servicetype",
  afdeling:    "cr1eb_lch_afdeling",
  varighed:    "cr1eb_lch_varighed"     // antal år aftalen løber (tom = ingen slutdato)
};
const VARIGHED_FIELD = AFTALE_FIELDS.varighed;

// lch_varighed kan være oprettet som tal eller tekst. Typen slås op i
// metadata én gang, så vi sender værdien i det format, kolonnen forventer.
let varighedIsText = null;
async function varighedErTekst() {
  if (varighedIsText !== null) return varighedIsText;
  try {
    const j = await dvFetch(`EntityDefinitions(LogicalName='${T.aftaletekst.logical}')/Attributes(LogicalName='${VARIGHED_FIELD}')?$select=AttributeType`);
    varighedIsText = ["String", "Memo"].includes(j?.AttributeType);
  } catch {
    varighedIsText = false;   // antag heltal
  }
  return varighedIsText;
}

// "", "2", 2 → null eller heltal 0-50
function parseVarighed(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 50) throw Object.assign(new Error("Varighed skal være et helt antal år (0-50)"), { status: 400 });
  return n;
}

// Fx "AT-20261118-3f9a2c" – unik og læsbar i Dataverse
function makeKey(prefix) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${d}-${crypto.randomBytes(3).toString("hex")}`;
}
const aftaleKey = () => makeKey("AT");

function mapAftale(r) {
  const o = { id: r[T.aftaletekst.id] };
  for (const [k, f] of Object.entries(AFTALE_FIELDS)) o[k] = r[f] ?? "";
  o.varighed = o.varighed === "" || o.varighed === null ? "" : String(o.varighed).trim();
  return o;
}

async function aftaleBody(input) {
  const body = {};
  for (const [k, f] of Object.entries(AFTALE_FIELDS)) {
    if (!(k in (input || {}))) continue;
    if (k === "varighed") {
      const n = parseVarighed(input[k]);
      body[f] = n === null ? null : (await varighedErTekst() ? String(n) : n);
    } else {
      body[f] = String(input[k] ?? "").trim().slice(0, 400);
    }
  }
  return body;
}

async function listAftaler() {
  const set = await entitySet(T.aftaletekst);
  const rows = await fetchAll(`${set}?$select=${[T.aftaletekst.id, "cr1eb_lch_name", ...Object.values(AFTALE_FIELDS)].join(",")}`);

  // Rækker uden nøgle (fx oprettet før lch_name blev automatisk) får en nu.
  // Fejler det, vises listen alligevel.
  for (const r of rows.filter(r => !String(r.cr1eb_lch_name || "").trim())) {
    try {
      await dvFetch(`${set}(${r[T.aftaletekst.id]})`, { method: "PATCH", body: { cr1eb_lch_name: aftaleKey() } });
    } catch { /* ignoreres */ }
  }

  return rows.map(mapAftale)
    .sort((a, b) =>
      a.varenr.localeCompare(b.varenr, "da", { numeric: true }) ||
      a.servicetype.localeCompare(b.servicetype, "da") ||
      a.afdeling.localeCompare(b.afdeling, "da"));
}

async function createAftale(input) {
  const body = await aftaleBody(input);
  if (!Object.values(body).some(v => v !== null && v !== "")) {
    throw Object.assign(new Error("Udfyld mindst ét felt"), { status: 400 });
  }
  body.cr1eb_lch_name = aftaleKey();
  const set = await entitySet(T.aftaletekst);
  const created = await dvFetch(set, { method: "POST", body, headers: { Prefer: "return=representation" } });
  return mapAftale(created || {});
}

async function updateAftale(id, input) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw Object.assign(new Error("Ugyldigt id"), { status: 400 });
  const set = await entitySet(T.aftaletekst);
  await dvFetch(`${set}(${id})`, { method: "PATCH", body: await aftaleBody(input) });
}

async function deleteAftale(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw Object.assign(new Error("Ugyldigt id"), { status: 400 });
  const set = await entitySet(T.aftaletekst);
  await dvFetch(`${set}(${id})`, { method: "DELETE" });
}

// ── Serviceaftaler (pr. kunde) ──────────────────────────────────────────────
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = msg => Object.assign(new Error(msg), { status: 400 });

// "2026-02-29" + 1 år → "2027-02-28" (sidste dag i måneden, hvis datoen ikke findes)
// Slutdato = startdato + varighed i år – 1 dag (fx 01-12-2026 + 1 år → 30-11-2027)
function slutFraStart(iso, years) {
  const d = new Date(addYears(iso, years) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function addYears(iso, years) {
  const [y, m, d] = iso.split("-").map(Number);
  const ty = y + years;
  const last = new Date(Date.UTC(ty, m, 0)).getUTCDate();
  return `${ty}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// Uden kundenr. hentes alle serviceaftaler
async function listServiceaftaler(kundenr) {
  kundenr = String(kundenr || "").trim();
  const set = await entitySet(T.serviceaftale);
  const filter = kundenr ? `&$filter=${encodeURIComponent(`cr1eb_lch_kundenr eq '${kundenr.replace(/'/g, "''")}'`)}` : "";
  const sel = [T.serviceaftale.id, "cr1eb_lch_kundenr", "cr1eb_lch_varenr", "cr1eb_lch_startdato",
               "cr1eb_lch_enddato", "cr1eb_lch_note", `_${VAREOPSLAG_NAV}_value`].join(",");
  const rows = await fetchAll(`${set}?$select=${sel}${filter}`);

  // Vis servicetype/afdeling fra aftaleteksten
  const tekster = new Map((await listAftaler()).map(a => [a.id, a]));
  return rows.map(r => {
    const a = tekster.get(r[`_${VAREOPSLAG_NAV}_value`]) || null;
    return {
      id: r[T.serviceaftale.id],
      aftaleId: r[`_${VAREOPSLAG_NAV}_value`] || "",
      kundenr: r.cr1eb_lch_kundenr || "",
      varenr: r.cr1eb_lch_varenr || a?.varenr || "",
      servicetype: a?.servicetype || "",
      afdeling: a?.afdeling || "",
      startdato: String(r.cr1eb_lch_startdato || "").slice(0, 10),
      enddato: String(r.cr1eb_lch_enddato || "").slice(0, 10),
      note: r.cr1eb_lch_note || ""
    };
  }).sort((a, b) => (b.startdato || "").localeCompare(a.startdato || ""));
}

// Dato-kolonnerne kan være "kun dato" (Edm.Date) eller "dato og klokkeslæt"
// (Edm.DateTimeOffset). Vi prøver først kun dato; afviser Dataverse det,
// sendes kl. 12:00 UTC, så datoen ikke flytter sig pga. tidszone.
async function postWithDates(set, body, dateFields) {
  try {
    return await dvFetch(set, { method: "POST", body, headers: { Prefer: "return=representation" } });
  } catch (e) {
    if (e.status !== 400 || !dateFields.some(f => body[f])) throw e;
    const b2 = { ...body };
    for (const f of dateFields) if (b2[f]) b2[f] = `${b2[f]}T12:00:00Z`;
    return await dvFetch(set, { method: "POST", body: b2, headers: { Prefer: "return=representation" } });
  }
}

// Opret (uden id) eller ret (med id) en serviceaftale
async function createServiceaftale(input) { return saveServiceaftale(input, null); }
async function updateServiceaftale(id, input) {
  if (!GUID.test(String(id || ""))) throw bad("Ugyldigt id");
  return saveServiceaftale(input, id);
}

async function saveServiceaftale(input, id) {
  const kundenr   = String(input?.kundenr || "").trim();
  const aftaleId  = String(input?.aftaleId || "").trim();
  const startdato = String(input?.startdato || "").trim();
  let   enddato   = String(input?.enddato || "").trim();
  const note      = String(input?.note || "").trim().slice(0, 2000);

  if (!kundenr) throw bad("Vælg en kunde");
  if (!GUID.test(aftaleId)) throw bad("Vælg en aftale");
  if (startdato && !ISO_DATE.test(startdato)) throw bad("Ugyldig startdato");
  if (enddato && !ISO_DATE.test(enddato)) throw bad("Ugyldig slutdato");
  if (startdato && enddato && enddato < startdato) throw bad("Slutdato ligger før startdato");

  const aftale = (await listAftaler()).find(a => a.id === aftaleId);
  if (!aftale) throw bad("Aftaleteksten findes ikke");

  // Ingen varighed på aftalen → ingen slutdato. Har den varighed, og er der
  // ingen slutdato med, beregnes den: startdato + varighed × 12 måneder.
  const varighed = aftale.varighed === "" ? null : Number(aftale.varighed);
  if (varighed === null || !Number.isFinite(varighed)) enddato = "";
  else if (!enddato && startdato) enddato = slutFraStart(startdato, varighed);

  const set = await entitySet(T.serviceaftale);
  const tekstSet = await entitySet(T.aftaletekst);
  const body = {
    cr1eb_lch_kundenr: kundenr,
    cr1eb_lch_varenr: aftale.varenr,
    [`${VAREOPSLAG_NAV}@odata.bind`]: `/${tekstSet}(${aftaleId})`
  };
  const datoer = ["cr1eb_lch_startdato", "cr1eb_lch_enddato"];

  if (!id) {
    body.cr1eb_lch_name = makeKey("SA");
    if (startdato) body.cr1eb_lch_startdato = startdato;
    if (enddato)   body.cr1eb_lch_enddato = enddato;
    if (note)      body.cr1eb_lch_note = note;
    const created = await postWithDates(set, body, datoer);
    return { id: created?.[T.serviceaftale.id] || null };
  }

  // Ret: tomme felter ryddes (null), så man også kan fjerne en dato eller note
  body.cr1eb_lch_startdato = startdato || null;
  body.cr1eb_lch_enddato = enddato || null;
  body.cr1eb_lch_note = note || null;
  try {
    await dvFetch(`${set}(${id})`, { method: "PATCH", body });
  } catch (e) {
    // Kolonnen er "dato og klokkeslæt": send kl. 12:00 UTC (som ved oprettelse)
    if (e.status !== 400 || !datoer.some(f => body[f])) throw e;
    const b2 = { ...body };
    for (const f of datoer) if (b2[f]) b2[f] = `${b2[f]}T12:00:00Z`;
    await dvFetch(`${set}(${id})`, { method: "PATCH", body: b2 });
  }
  return { id };
}

// ── Kolonnegrupper ──────────────────────────────────────────────────────────
// lch_name        gruppens navn, fx "Logistik"
// lch_afdelinger  afdelinger (Entra "department"), én pr. linje
// lch_kolonner    kolonne-nøgler i visningsrækkefølge, som JSON-array
// lch_standard    Ja = bruges af alle, hvis afdeling ikke er i nogen gruppe
const KEY = /^[a-z0-9_]{1,40}$/i;

function parseList(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(x => String(x).trim()).filter(Boolean); } catch { /* fald igennem */ }
  }
  return s.split(/[\r\n,;]+/).map(x => x.trim()).filter(Boolean);
}

function mapGruppe(r) {
  return {
    id: r[T.kolonnegruppe.id],
    navn: r.cr1eb_lch_name || "",
    afdelinger: parseList(r.cr1eb_lch_afdelinger),
    kolonner: parseList(r.cr1eb_lch_kolonner).filter(k => KEY.test(k)),
    standard: r.cr1eb_lch_standard === true
  };
}

async function listGrupper() {
  const rows = await fetchAll(`${T.kolonnegruppe.set}?$select=${T.kolonnegruppe.id},cr1eb_lch_name,cr1eb_lch_afdelinger,cr1eb_lch_kolonner,cr1eb_lch_standard`);
  return rows.map(mapGruppe).sort((a, b) => a.navn.localeCompare(b.navn, "da"));
}

function gruppeBody(input) {
  const navn = String(input?.navn || "").trim().slice(0, 100);
  if (!navn) throw bad("Gruppen skal have et navn");
  const afdelinger = [...new Set((Array.isArray(input?.afdelinger) ? input.afdelinger : parseList(input?.afdelinger))
    .map(a => String(a).trim()).filter(Boolean))];
  const kolonner = [...new Set((Array.isArray(input?.kolonner) ? input.kolonner : []).map(k => String(k).trim()).filter(k => KEY.test(k)))];
  if (!kolonner.length) throw bad("Vælg mindst én kolonne");
  return {
    cr1eb_lch_name: navn,
    cr1eb_lch_afdelinger: afdelinger.join("\n"),
    cr1eb_lch_kolonner: JSON.stringify(kolonner),
    cr1eb_lch_standard: input?.standard === true
  };
}

// Kun én gruppe kan være standard
async function clearStandard(exceptId) {
  for (const g of (await listGrupper()).filter(g => g.standard && g.id !== exceptId)) {
    await dvFetch(`${T.kolonnegruppe.set}(${g.id})`, { method: "PATCH", body: { cr1eb_lch_standard: false } });
  }
}

async function saveGruppe(input, id) {
  const body = gruppeBody(input);
  let savedId = id;
  if (id) {
    if (!GUID.test(id)) throw bad("Ugyldigt id");
    await dvFetch(`${T.kolonnegruppe.set}(${id})`, { method: "PATCH", body });
  } else {
    const created = await dvFetch(T.kolonnegruppe.set, { method: "POST", body, headers: { Prefer: "return=representation" } });
    savedId = created?.[T.kolonnegruppe.id] || null;
  }
  if (body.cr1eb_lch_standard) await clearStandard(savedId);
  return { id: savedId };
}

async function deleteGruppe(id) {
  if (!GUID.test(String(id || ""))) throw bad("Ugyldigt id");
  await dvFetch(`${T.kolonnegruppe.set}(${id})`, { method: "DELETE" });
}

// Afdelinger i Entra (fra gruppen "Alle - lely center herrup"), til forslag i admin
async function entraAfdelinger() {
  const token = await N.graphToken();
  const filter = encodeURIComponent("displayName eq 'Alle - lely center herrup'");
  const g = await N.graphJson(token, `groups?$filter=${filter}&$select=id`);
  const groupId = g.value?.[0]?.id;
  if (!groupId) return [];
  const set = new Map();
  let url = `groups/${groupId}/transitiveMembers/microsoft.graph.user?$select=department,accountEnabled&$top=999`;
  for (let guard = 0; url && guard < 50; guard++) {
    const j = await N.graphJson(token, url);
    for (const u of j.value || []) {
      if (u.accountEnabled === false) continue;
      const d = String(u.department || "").trim();
      if (d) set.set(d, (set.get(d) || 0) + 1);
    }
    url = j["@odata.nextLink"] || null;
  }
  return [...set.entries()].map(([navn, antal]) => ({ navn, antal })).sort((a, b) => a.navn.localeCompare(b.navn, "da"));
}

// Den indloggede brugers afdeling (Entra "department")
async function userDepartment(userId) {
  if (!userId) return "";
  try {
    const token = await N.graphToken();
    const u = await N.graphJson(token, `users/${userId}?$select=department`);
    return String(u.department || "").trim();
  } catch { return ""; }
}

// Gruppen for en afdeling: første gruppe, hvor afdelingen står – ellers standard
function gruppeForAfdeling(grupper, afdeling) {
  const a = String(afdeling || "").trim().toLowerCase();
  return (a && grupper.find(g => g.afdelinger.some(x => x.toLowerCase() === a)))
      || grupper.find(g => g.standard)
      || null;
}

// Ret eksisterende serviceaftaler, hvis slutdato er beregnet efter den gamle
// regel (startdato + varighed) – så den bliver startdato + varighed – 1 dag.
// Aftaler med en manuelt rettet slutdato røres ikke.
async function retSlutdatoer(udfoer) {
  const [aftaler, tekster] = await Promise.all([listServiceaftaler(), listAftaler()]);
  const varighed = new Map(tekster.filter(t => t.varighed !== "" && Number.isFinite(Number(t.varighed))).map(t => [t.id, Number(t.varighed)]));
  const kandidater = [];
  for (const a of aftaler) {
    const v = varighed.get(a.aftaleId);
    if (v === undefined || !a.startdato || !a.enddato) continue;
    if (a.enddato === addYears(a.startdato, v)) {
      kandidater.push({ id: a.id, kundenr: a.kundenr, servicetype: a.servicetype, startdato: a.startdato, fra: a.enddato, til: slutFraStart(a.startdato, v) });
    }
  }
  let rettet = 0;
  const fejl = [];
  if (udfoer) {
    const set = await entitySet(T.serviceaftale);
    for (const k of kandidater) {
      try {
        try {
          await dvFetch(`${set}(${k.id})`, { method: "PATCH", body: { cr1eb_lch_enddato: k.til } });
        } catch (e) {
          if (e.status !== 400) throw e;
          await dvFetch(`${set}(${k.id})`, { method: "PATCH", body: { cr1eb_lch_enddato: `${k.til}T12:00:00Z` } });
        }
        rettet++;
      } catch (e) {
        fejl.push(`${k.kundenr}: ${e.message}`);
      }
    }
  }
  return { antal: kandidater.length, kandidater: kandidater.slice(0, 200), rettet, fejl };
}

// ── Hjælpetekster ───────────────────────────────────────────────────────────
// Tabellen lch_kundeliste_hjaelpetekst:
//   lch_name          (primær kolonne) nøgle: "kol:<kolonne>" eller "el:<element-id>"
//   lch_hjaelpetekst  tekst, flere linjer
const HJ_KEY = /^(kol|el):[A-Za-z0-9_\-]{1,60}$/;

async function listHjaelp() {
  const set = await entitySet(T.hjaelp);
  const rows = await fetchAll(`${set}?$select=${T.hjaelp.id},cr1eb_lch_name,cr1eb_lch_hjaelpetekst`);
  return rows
    .map(r => ({ id: r[T.hjaelp.id], key: String(r.cr1eb_lch_name || "").trim(), tekst: String(r.cr1eb_lch_hjaelpetekst || "") }))
    .filter(r => r.key)
    .sort((a, b) => a.key.localeCompare(b.key, "da"));
}

// Nøgle → tekst, til kundelisten
async function hjaelpMap() {
  const out = {};
  for (const h of await listHjaelp()) if (h.tekst.trim()) out[h.key] = h.tekst;
  return out;
}

async function saveHjaelp(input, id) {
  const key = String(input?.key || "").trim();
  const tekst = String(input?.tekst || "").replace(/\r\n/g, "\n").trim().slice(0, 4000);
  if (!HJ_KEY.test(key)) throw bad("Vælg en kolonne eller knap");
  if (!tekst) throw bad("Skriv en hjælpetekst");
  const set = await entitySet(T.hjaelp);
  const body = { cr1eb_lch_name: key, cr1eb_lch_hjaelpetekst: tekst };

  // Samme nøgle må kun findes én gang
  const dublet = (await listHjaelp()).find(h => h.key.toLowerCase() === key.toLowerCase() && h.id !== id);
  if (dublet) throw bad("Der findes allerede en hjælpetekst til den kolonne/knap – ret den i stedet");

  if (id) {
    if (!GUID.test(id)) throw bad("Ugyldigt id");
    await dvFetch(`${set}(${id})`, { method: "PATCH", body });
    return { id };
  }
  const created = await dvFetch(set, { method: "POST", body, headers: { Prefer: "return=representation" } });
  return { id: created?.[T.hjaelp.id] || null };
}

async function deleteHjaelp(id) {
  if (!GUID.test(String(id || ""))) throw bad("Ugyldigt id");
  const set = await entitySet(T.hjaelp);
  await dvFetch(`${set}(${id})`, { method: "DELETE" });
}

module.exports = {
  retSlutdatoer,
  listHjaelp, hjaelpMap, saveHjaelp, deleteHjaelp,
  ADMIN_ROLES, isKundelisteAdmin,
  loadFarver, kontraktTyper, saveFarve,
  listAftaler, createAftale, updateAftale, deleteAftale,
  listServiceaftaler, createServiceaftale, updateServiceaftale,
  listGrupper, saveGruppe, deleteGruppe, entraAfdelinger, userDepartment, gruppeForAfdeling
};
