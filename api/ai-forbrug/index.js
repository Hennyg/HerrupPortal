// api/ai-forbrug/index.js
// AI-forbrug (tokens) pr. bruger, dag og funktion til ai-forbrug.html.
//
//   GET /api/ai-forbrug?from=2026-11-01&to=2026-11-26
//
// Kræver rollen portal_admin eller portal_herrup_portal_admin.
// Data: lch_ai_forbrug (se api/_aiLog.js).
//
// Valgfri app settings til en anslået pris (USD pr. 1 mio. tokens / pr. billede):
//   AI_PRIS_INPUT, AI_PRIS_CACHED, AI_PRIS_OUTPUT, AI_PRIS_BILLEDE, AI_KURS_USD_DKK (standard 7)
// Uden AI_PRIS_INPUT og AI_PRIS_OUTPUT vises kun tokens.

const N = require("../_news");
const { dvFetch } = require("../_dv");
const { ENTITY_SET } = require("../_aiLog");

const ADMIN_ROLES = ["portal_admin", "portal_herrup_portal_admin"];
const TZ = "Europe/Copenhagen";
const MAX_DAYS = 366;
const MAX_ROWS = 50000;
const COLS = [
  "cr175_lch_useremail", "cr175_lch_tidspunkt", "cr175_lch_kilde", "cr175_lch_opgave", "cr175_lch_model",
  "cr175_lch_inputtokens", "cr175_lch_cachedtokens", "cr175_lch_outputtokens", "cr175_lch_reasoningtokens",
  "cr175_lch_totaltokens", "cr175_lch_billeder", "cr175_lch_opfoelgning"
];

const isoDay = d => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hourOf = d => Number(new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function priser() {
  const n = k => {
    const raw = String(process.env[k] ?? "").trim();
    if (!raw) return null;
    const v = Number(raw.replace(",", "."));
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  const input = n("AI_PRIS_INPUT"), output = n("AI_PRIS_OUTPUT");
  if (input === null || output === null) return null;
  return {
    input, output,
    cached: n("AI_PRIS_CACHED") ?? input,
    billede: n("AI_PRIS_BILLEDE") ?? 0,
    kurs: n("AI_KURS_USD_DKK") ?? 7
  };
}

function kr(r, p) {
  if (!p) return null;
  const uncached = Math.max(0, r.input - r.cached);
  const usd = (uncached * p.input + r.cached * p.cached + r.output * p.output) / 1e6 + r.billeder * p.billede;
  return usd * p.kurs;
}

async function fetchRows(fromUtc, toUtc) {
  const filter = `cr175_lch_tidspunkt ge ${fromUtc} and cr175_lch_tidspunkt lt ${toUtc}`;
  let path = `${ENTITY_SET}?$select=${COLS.join(",")}&$filter=${encodeURIComponent(filter)}&$orderby=cr175_lch_tidspunkt desc`;
  const rows = [];
  while (path && rows.length < MAX_ROWS) {
    const j = await dvFetch(path, { headers: { Prefer: "odata.maxpagesize=5000" } });
    rows.push(...(j?.value || []));
    const next = j?.["@odata.nextLink"];
    path = next ? next.split("/api/data/v9.2/")[1] : null;
  }
  return rows;
}

function sum(target, r) {
  target.kald += 1;
  target.input += r.input;
  target.cached += r.cached;
  target.output += r.output;
  target.reasoning += r.reasoning;
  target.total += r.total;
  target.billeder += r.billeder;
  if (r.kr !== null) target.kr = (target.kr || 0) + r.kr;
}
const tom = extra => ({ ...extra, kald: 0, input: 0, cached: 0, output: 0, reasoning: 0, total: 0, billeder: 0, kr: null });

module.exports = async function (context, req) {
  const me = N.getPrincipal(req);
  if (!me) return N.json(context, 401, { error: "Ikke logget ind" });
  try {
    const roles = await N.lookupRoles(me);
    if (!roles.some(r => ADMIN_ROLES.includes(String(r).toLowerCase()))) {
      return N.json(context, 403, { error: "Kræver rollen portal_admin" });
    }
  } catch (e) {
    return N.json(context, 500, { error: `Kunne ikke slå roller op: ${e.message}` });
  }

  try {
    const today = isoDay(new Date());
    const to = DATE.test(String(req.query.to || "")) ? req.query.to : today;
    const from = DATE.test(String(req.query.from || "")) ? req.query.from : to;
    if (from > to) return N.json(context, 400, { error: "Fra-dato er efter til-dato" });
    const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
    if (days > MAX_DAYS) return N.json(context, 400, { error: `Maks ${MAX_DAYS} dage ad gangen` });

    // Hent med en dags margen i UTC og filtrér på dansk dato bagefter
    const fromUtc = new Date(Date.parse(from) - 86400000).toISOString();
    const toUtc = new Date(Date.parse(to) + 2 * 86400000).toISOString();
    const p = priser();

    const rows = (await fetchRows(fromUtc, toUtc)).map(x => {
      const t = new Date(x.cr175_lch_tidspunkt);
      const r = {
        tid: x.cr175_lch_tidspunkt,
        dag: isoDay(t),
        time: hourOf(t),
        email: String(x.cr175_lch_useremail || "ukendt").toLowerCase(),
        kilde: x.cr175_lch_kilde || "ai",
        opgave: x.cr175_lch_opgave || "",
        model: x.cr175_lch_model || "",
        input: Number(x.cr175_lch_inputtokens) || 0,
        cached: Number(x.cr175_lch_cachedtokens) || 0,
        output: Number(x.cr175_lch_outputtokens) || 0,
        reasoning: Number(x.cr175_lch_reasoningtokens) || 0,
        total: Number(x.cr175_lch_totaltokens) || 0,
        billeder: Number(x.cr175_lch_billeder) || 0,
        opfoelgning: x.cr175_lch_opfoelgning === true
      };
      r.kr = kr(r, p);
      return r;
    }).filter(r => r.dag >= from && r.dag <= to);

    const total = tom({});
    const brugere = new Map(), dage = new Map(), funktioner = new Map();
    const timer = Array.from({ length: 24 }, (_, h) => tom({ time: h }));
    for (const r of rows) {
      sum(total, r);
      if (!brugere.has(r.email)) brugere.set(r.email, tom({ email: r.email, sidst: r.tid }));
      const b = brugere.get(r.email);
      sum(b, r);
      if (r.tid > b.sidst) b.sidst = r.tid;
      if (!dage.has(r.dag)) dage.set(r.dag, tom({ dag: r.dag }));
      sum(dage.get(r.dag), r);
      const fk = `${r.kilde}|${r.opgave}`;
      if (!funktioner.has(fk)) funktioner.set(fk, tom({ kilde: r.kilde, opgave: r.opgave }));
      sum(funktioner.get(fk), r);
      sum(timer[r.time], r);
    }

    // Alle dage i perioden (også dage uden forbrug)
    const dagListe = [];
    for (let d = Date.parse(from); d <= Date.parse(to); d += 86400000) {
      const key = new Date(d).toISOString().slice(0, 10);
      dagListe.push(dage.get(key) || tom({ dag: key }));
    }

    return N.json(context, 200, {
      from, to,
      prisSat: !!p,
      total,
      brugere: [...brugere.values()].sort((a, b) => b.total - a.total || b.billeder - a.billeder),
      dage: dagListe,
      timer,
      funktioner: [...funktioner.values()].sort((a, b) => b.total - a.total),
      storste: [...rows].sort((a, b) => b.total - a.total).slice(0, 25),
      seneste: rows.slice(0, 200)
    });
  } catch (e) {
    context.log("ai-forbrug fejl:", e.message);
    const mangler = /does not exist|not found|Resource not found/i.test(e.message);
    return N.json(context, 500, {
      error: mangler ? `Tabellen ${ENTITY_SET} findes ikke endnu – opret lch_ai_forbrug i Dataverse` : e.message
    });
  }
};
