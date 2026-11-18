// api/_kundelisteAdmin.js
// Fælles hjælpefunktioner til Kundeliste-admin (kundeliste_admin.html):
//   - adgangstjek (portal_admin / portal_kundeliste_admin)
//   - kontraktfarver  (tabel lch_kontraktfarve)
//   - aftaletekster   (tabel lch_serviceaftaler_aftalertekst)
// Alle tabeller ligger i Kundeliste-miljøet (KL_DV_URL) – samme som kunder/produkter.

const N = require("./_news");
const { dvFetch, fetchAll } = require("./_dvKunde");

const ADMIN_ROLES = ["portal_admin", "portal_kundeliste_admin"];

// Logiske tabelnavne. EntitySetName (det navn der bruges i URL'en) slås op i
// Dataverse-metadata første gang, så vi ikke skal gætte flertalsformen.
const T = {
  farve:       { logical: "cr1eb_lch_kontraktfarve",               id: "cr1eb_lch_kontraktfarveid" },
  aftaletekst: { logical: "cr1eb_lch_serviceaftaler_aftalertekst", id: "cr1eb_lch_serviceaftaler_aftalertekstid" },
  produkt:     { set: "cr1eb_lch_kundeprodukts" }
};

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
const AFTALE_FIELDS = {
  varenr:      "cr1eb_lch_varenr",
  navn:        "cr1eb_lch_name",
  servicetype: "cr1eb_lch_servicetype",
  afdeling:    "cr1eb_lch_afdeling"
};

function mapAftale(r) {
  const o = { id: r[T.aftaletekst.id] };
  for (const [k, f] of Object.entries(AFTALE_FIELDS)) o[k] = r[f] || "";
  return o;
}

function aftaleBody(input) {
  const body = {};
  for (const [k, f] of Object.entries(AFTALE_FIELDS)) {
    if (k in (input || {})) body[f] = String(input[k] ?? "").trim().slice(0, 400);
  }
  return body;
}

async function listAftaler() {
  const set = await entitySet(T.aftaletekst);
  const rows = await fetchAll(`${set}?$select=${[T.aftaletekst.id, ...Object.values(AFTALE_FIELDS)].join(",")}`);
  return rows.map(mapAftale)
    .sort((a, b) => a.varenr.localeCompare(b.varenr, "da", { numeric: true }) || a.navn.localeCompare(b.navn, "da"));
}

async function createAftale(input) {
  const body = aftaleBody(input);
  if (!body.cr1eb_lch_varenr && !body.cr1eb_lch_name) {
    throw Object.assign(new Error("Udfyld mindst varenr. eller navn"), { status: 400 });
  }
  const set = await entitySet(T.aftaletekst);
  const created = await dvFetch(set, { method: "POST", body, headers: { Prefer: "return=representation" } });
  return mapAftale(created || {});
}

async function updateAftale(id, input) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw Object.assign(new Error("Ugyldigt id"), { status: 400 });
  const set = await entitySet(T.aftaletekst);
  await dvFetch(`${set}(${id})`, { method: "PATCH", body: aftaleBody(input) });
}

async function deleteAftale(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw Object.assign(new Error("Ugyldigt id"), { status: 400 });
  const set = await entitySet(T.aftaletekst);
  await dvFetch(`${set}(${id})`, { method: "DELETE" });
}

module.exports = {
  ADMIN_ROLES, isKundelisteAdmin,
  loadFarver, kontraktTyper, saveFarve,
  listAftaler, createAftale, updateAftale, deleteAftale
};
