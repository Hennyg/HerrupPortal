// api/_rabat.js
// Kemi-rabatordningen (Kundeliste-miljøet, KL_DV_URL):
//   lch_rabat_grupper  – én række pr. kunde: gruppe, robot/yverpleje/tank, ændring, kommentar
//   lch_rabat_historik – én række pr. ændret felt (hvem, hvornår, fra/til, kilde)
//   lch_rabat_struktur – rabat-% pr. gruppe og købsgrænse (+ farve pr. gruppe)
//
// Kolonnetyperne i lch_rabat_grupper (tekst / ja-nej / heltal) slås op i
// metadata, så koden virker, uanset hvilken type kolonnerne har.

const crypto = require("crypto");
const { dvFetch, fetchAll } = require("./_dvKunde");

const T = {
  gruppe:   { logical: "cr1eb_lch_rabat_grupper",  set: "cr1eb_lch_rabat_gruppers",  id: "cr1eb_lch_rabat_grupperid" },
  historik: { logical: "cr1eb_lch_rabat_historik", set: "cr1eb_lch_rabat_historiks", id: "cr1eb_lch_rabat_historikid" },
  struktur: { logical: "cr1eb_lch_rabat_struktur", set: "cr1eb_lch_rabat_strukturs", id: "cr1eb_lch_rabat_strukturid" },
  kunde:    { set: "cr1eb_lch_kundes", id: "cr1eb_lch_kundeid" }
};

// Felter i lch_rabat_grupper (nøgle i appen → kolonne)
const F = {
  gruppe:     "cr1eb_lch_kemi_rabat_gr",
  robot:      "cr1eb_lch_robot",
  yverpleje:  "cr1eb_lch_yver",        // kolonnen hedder lch_yver i Dataverse
  tank:       "cr1eb_lch_tank",
  rabatchange:"cr1eb_lch_rabatchange",
  kommentar:  "cr1eb_lch_kommentar"     // tekst (flere linjer) – oprettes i tabellen
};
const KUNDE_NAV = "cr1eb_lch_kundenr";       // opslag → kunde
const KUNDE_VAL = "_cr1eb_lch_kundenr_value";
const HIST_NAV  = "cr1eb_lch_rabatgruppe";   // opslag → rabatgruppe (i historikken)
const YDELSER = ["robot", "yverpleje", "tank"];
const LABEL = { gruppe: "Kemi rabat gr.", robot: "Robot rengøring", yverpleje: "Yverpleje", tank: "Tank rengøring", kommentar: "Kommentar" };

const bad = msg => Object.assign(new Error(msg), { status: 400 });
const key = prefix => `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex")}`;

// Kundenr. som i kundetabellen: rene cifre fyldes op til 10 tegn (0080002026)
function normKundenr(v) {
  const s = String(v ?? "").trim().replace(/\.0+$/, "");
  return /^\d+$/.test(s) && s.length < 10 ? s.padStart(10, "0") : s;
}

// ── Kolonnetyper ────────────────────────────────────────────────────────────
let attrCache = null;
async function attrTypes() {
  if (attrCache) return attrCache;
  const m = {};
  try {
    const j = await dvFetch(`EntityDefinitions(LogicalName='${T.gruppe.logical}')/Attributes?$select=LogicalName,AttributeType`);
    for (const a of j.value || []) m[a.LogicalName] = a.AttributeType;
  } catch { /* uden metadata antages tekst */ }
  attrCache = m;
  return m;
}
const hasKommentar = types => !Object.keys(types).length || !!types[F.kommentar];

const truthy = v => v === true || v === 1 || /^(1|x|ja|yes|true|sand)$/i.test(String(v ?? "").trim());

function fromDv(r) {
  const g = parseInt(String(r[F.gruppe] ?? "").trim(), 10);
  return {
    id: r[T.gruppe.id],
    kundeId: r[KUNDE_VAL] || null,
    kundenr: normKundenr(r.cr1eb_lch_name),
    gruppe: Number.isFinite(g) ? g : null,
    robot: truthy(r[F.robot]),
    yverpleje: truthy(r[F.yverpleje]),
    tank: truthy(r[F.tank]),
    rabatchange: String(r[F.rabatchange] ?? "").trim(),
    kommentar: String(r[F.kommentar] ?? "").trim(),
    aendret: r.modifiedon || ""
  };
}

function toDv(field, value, types) {
  const t = types[F[field]] || "String";
  if (YDELSER.includes(field)) {
    if (t === "Boolean") return !!value;
    if (t === "Integer") return value ? 1 : null;
    return value ? "1" : "";
  }
  if (field === "gruppe") {
    if (value === null || value === "" || value === undefined) return null;
    return t === "Integer" ? Number(value) : String(value);
  }
  return String(value ?? "");
}

const vis = (field, v) => YDELSER.includes(field) ? (v ? "Ja" : "Nej") : (v === null || v === undefined ? "" : String(v));

// ── Læs ─────────────────────────────────────────────────────────────────────
const SELECT_G = () => [T.gruppe.id, "cr1eb_lch_name", KUNDE_VAL, "modifiedon", F.gruppe, F.robot, F.yverpleje, F.tank, F.rabatchange];

async function listRabat() {
  const types = await attrTypes();
  const sel = [...SELECT_G(), ...(hasKommentar(types) && Object.keys(types).length ? [F.kommentar] : [])];
  const rows = await fetchAll(`${T.gruppe.set}?$select=${sel.join(",")}`);
  // Kundenr. fra kunden (opslaget) hvis navnet ikke er sat
  const kunder = await kundeMap();
  const byId = new Map([...kunder.values()].map(k => [k.id, k]));
  return rows.map(fromDv).map(r => {
    const k = r.kundeId && byId.get(r.kundeId);
    if (k) { r.kundenr = k.kundenr; r.navn = k.navn; }
    return r;
  });
}

let kundeCache = { at: 0, map: null };
async function kundeMap() {
  if (kundeCache.map && Date.now() - kundeCache.at < 5 * 60 * 1000) return kundeCache.map;
  const rows = await fetchAll(`${T.kunde.set}?$select=${T.kunde.id},cr1eb_lch_kundenr,cr1eb_lch_navn`);
  const map = new Map();
  for (const r of rows) {
    const nr = normKundenr(r.cr1eb_lch_kundenr);
    if (nr) map.set(nr, { id: r[T.kunde.id], kundenr: nr, navn: r.cr1eb_lch_navn || "" });
  }
  kundeCache = { at: Date.now(), map };
  return map;
}

async function rabatForKunde(kundenr) {
  kundenr = normKundenr(kundenr);
  const k = (await kundeMap()).get(kundenr);
  const types = await attrTypes();
  const sel = [...SELECT_G(), ...(hasKommentar(types) && Object.keys(types).length ? [F.kommentar] : [])].join(",");
  const filter = k
    ? `${KUNDE_VAL} eq ${k.id}`
    : `cr1eb_lch_name eq '${kundenr.replace(/'/g, "''")}'`;
  const j = await dvFetch(`${T.gruppe.set}?$select=${sel}&$filter=${encodeURIComponent(filter)}&$top=1`);
  const r = j.value?.[0];
  return r ? { ...fromDv(r), kundenr, navn: k?.navn || "" } : null;
}

async function historik(kundenr) {
  kundenr = normKundenr(kundenr);
  const filter = encodeURIComponent(`cr1eb_lch_kundenr eq '${kundenr.replace(/'/g, "''")}'`);
  const rows = await fetchAll(`${T.historik.set}?$select=cr1eb_lch_felt,cr1eb_lch_gammel_vaerdi,cr1eb_lch_ny_vaerdi,cr1eb_lch_aendret_af,cr1eb_lch_aendret_tid,cr1eb_lch_kilde,cr1eb_lch_note,createdon&$filter=${filter}`);
  return rows.map(r => ({
    felt: r.cr1eb_lch_felt || "",
    label: LABEL[r.cr1eb_lch_felt] || r.cr1eb_lch_felt || "",
    gammel: r.cr1eb_lch_gammel_vaerdi || "",
    ny: r.cr1eb_lch_ny_vaerdi || "",
    af: r.cr1eb_lch_aendret_af || "",
    tid: r.cr1eb_lch_aendret_tid || r.createdon || "",
    kilde: r.cr1eb_lch_kilde || "",
    note: r.cr1eb_lch_note || ""
  })).sort((a, b) => String(b.tid).localeCompare(String(a.tid)));
}

// ── Gem (portal og import) ──────────────────────────────────────────────────
// input: { kundenr, gruppe?, robot?, yverpleje?, tank?, kommentar?, rabatchange? }
// Felter der ikke er med i input, røres ikke.
// opts: { kilde: "Portal" | "Import", af: mail, existing?: række (import) }
async function gemRabat(input, opts) {
  const types = await attrTypes();
  const kundenr = normKundenr(input?.kundenr);
  if (!kundenr) throw bad("Kundenr. mangler");
  const kunde = (await kundeMap()).get(kundenr);
  if (!kunde) throw bad(`Kunde ${kundenr} findes ikke i kundelisten`);

  const existing = opts.existing !== undefined ? opts.existing : await rabatForKunde(kundenr);
  const next = {};
  if ("gruppe" in input) {
    const g = input.gruppe === null || input.gruppe === "" ? null : parseInt(input.gruppe, 10);
    if (g !== null && (!Number.isFinite(g) || g < 0 || g > 99)) throw bad(`Ugyldig gruppe: ${input.gruppe}`);
    next.gruppe = g;
  }
  for (const y of YDELSER) if (y in input) next[y] = truthy(input[y]);
  if ("kommentar" in input && hasKommentar(types)) next.kommentar = String(input.kommentar ?? "").trim().slice(0, 4000);

  // Hvad er ændret?
  const old = existing || { gruppe: null, robot: false, yverpleje: false, tank: false, kommentar: "", rabatchange: "" };
  const changed = Object.keys(next).filter(f => vis(f, old[f]) !== vis(f, next[f]));

  // Rabat ændring: fra Excel som den står; i portalen beregnes den ud fra ydelserne
  let rabatchange;
  if ("rabatchange" in input) rabatchange = String(input.rabatchange ?? "").trim().slice(0, 200);
  else if (opts.kilde !== "Import") {
    const yd = changed.filter(f => YDELSER.includes(f)).map(f => `${next[f] ? "+" : "-"} ${LABEL[f].toLowerCase()}`);
    if (yd.length) rabatchange = yd.join(", ");
  }
  const changeRabat = rabatchange !== undefined && rabatchange !== (old.rabatchange || "");

  if (existing && !changed.length && !changeRabat) return { kundenr, status: "uændret", changes: 0 };

  const body = {};
  for (const f of changed) body[F[f]] = toDv(f, next[f], types);
  if (changeRabat) body[F.rabatchange] = rabatchange;

  let id = existing?.id;
  if (!existing) {
    body.cr1eb_lch_name = kundenr;
    body[`${KUNDE_NAV}@odata.bind`] = `/${T.kunde.set}(${kunde.id})`;
    const created = await dvFetch(T.gruppe.set, { method: "POST", body, headers: { Prefer: "return=representation" } });
    id = created?.[T.gruppe.id];
  } else {
    await dvFetch(`${T.gruppe.set}(${id})`, { method: "PATCH", body });
  }

  // Historik: én række pr. ændret felt
  const tid = new Date().toISOString();
  for (const f of changed) {
    await dvFetch(T.historik.set, {
      method: "POST",
      body: {
        cr1eb_lch_name: key("RH"),
        [`${HIST_NAV}@odata.bind`]: `/${T.gruppe.set}(${id})`,
        cr1eb_lch_kundenr: kundenr,
        cr1eb_lch_felt: f,
        cr1eb_lch_gammel_vaerdi: existing ? vis(f, old[f]) : "",
        cr1eb_lch_ny_vaerdi: vis(f, next[f]),
        cr1eb_lch_aendret_af: opts.af || "",
        cr1eb_lch_aendret_tid: tid,
        cr1eb_lch_kilde: opts.kilde || "Portal",
        ...(opts.note ? { cr1eb_lch_note: opts.note } : {})
      }
    });
  }
  return { kundenr, status: existing ? "opdateret" : "ny", changes: changed.length };
}

// Import af en bunke rækker fra Excel (klienten sender ~20 ad gangen)
async function importer(rows, af) {
  const types = await attrTypes();
  const alle = await listRabat();
  const byNr = new Map(alle.map(r => [r.kundenr, r]));
  const result = [];
  for (const row of rows || []) {
    const kundenr = normKundenr(row.kundenr);
    try {
      const input = { kundenr };
      for (const f of ["gruppe", ...YDELSER, "rabatchange"]) if (f in row) input[f] = row[f];
      if ("kommentar" in row && String(row.kommentar || "").trim()) {
        if (hasKommentar(types)) input.kommentar = row.kommentar;
        else throw bad("Kolonnen lch_kommentar findes ikke i lch_rabat_grupper");
      }
      result.push(await gemRabat(input, { kilde: "Import", af, existing: byNr.get(kundenr) || null, note: row.ark ? `Fra ark: ${row.ark}` : "" }));
    } catch (e) {
      result.push({ kundenr, status: "fejl", error: e.message });
    }
  }
  return result;
}

// ── Rabatstruktur ───────────────────────────────────────────────────────────
async function listStruktur() {
  const rows = await fetchAll(`${T.struktur.set}?$select=${T.struktur.id},cr1eb_lch_gruppe,cr1eb_lch_koebsgraense,cr1eb_lch_rabatprocent,cr1eb_lch_farve`);
  return rows.map(r => ({
    id: r[T.struktur.id],
    gruppe: r.cr1eb_lch_gruppe ?? null,
    koebsgraense: r.cr1eb_lch_koebsgraense ?? null,
    rabatprocent: r.cr1eb_lch_rabatprocent ?? null,
    farve: /^#[0-9a-f]{6}$/i.test(String(r.cr1eb_lch_farve || "").trim()) ? String(r.cr1eb_lch_farve).trim().toLowerCase() : ""
  })).sort((a, b) => (a.gruppe ?? 0) - (b.gruppe ?? 0) || (a.koebsgraense ?? 0) - (b.koebsgraense ?? 0));
}

async function gemStruktur(items) {
  const existing = await listStruktur();
  for (const it of items || []) {
    const gruppe = parseInt(it.gruppe, 10);
    const graense = parseInt(String(it.koebsgraense ?? "").replace(/\D/g, ""), 10);
    const pct = parseInt(it.rabatprocent, 10);
    if (!Number.isFinite(gruppe) || !Number.isFinite(graense) || !Number.isFinite(pct)) throw bad("Udfyld gruppe, købsgrænse og rabat % på alle rækker");
    const farve = /^#[0-9a-f]{6}$/i.test(String(it.farve || "")) ? String(it.farve).toLowerCase() : "";
    const body = {
      cr1eb_lch_name: `Gruppe ${gruppe} – ${graense.toLocaleString("da-DK")}`,
      cr1eb_lch_gruppe: gruppe, cr1eb_lch_koebsgraense: graense, cr1eb_lch_rabatprocent: pct, cr1eb_lch_farve: farve
    };
    if (it.id && existing.some(e => e.id === it.id)) await dvFetch(`${T.struktur.set}(${it.id})`, { method: "PATCH", body });
    else await dvFetch(T.struktur.set, { method: "POST", body });
  }
}

async function sletStruktur(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw bad("Ugyldigt id");
  await dvFetch(`${T.struktur.set}(${id})`, { method: "DELETE" });
}

module.exports = {
  normKundenr, listRabat, rabatForKunde, historik, gemRabat, importer,
  listStruktur, gemStruktur, sletStruktur, attrTypes, hasKommentar
};
