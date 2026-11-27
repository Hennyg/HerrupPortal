// api/_aiLog.js
// Logger AI-forbrug (tokens) pr. kald til Dataverse-tabellen lch_ai_forbrug
// (entity set cr175_lch_ai_forbrugs – kan ændres med app-indstillingen
// AI_LOG_ENTITY_SET). Selve teksten, brugeren sender, gemmes IKKE – kun hvem,
// hvornår, hvilken funktion/opgave, model og antal tokens/billeder.
//
// Kolonner (logiske navne):
//   cr175_lch_name (primær), cr175_lch_useremail, cr175_lch_tidspunkt,
//   cr175_lch_kilde, cr175_lch_opgave, cr175_lch_model,
//   cr175_lch_inputtokens, cr175_lch_cachedtokens, cr175_lch_outputtokens,
//   cr175_lch_reasoningtokens, cr175_lch_totaltokens, cr175_lch_billeder,
//   cr175_lch_opfoelgning, cr175_lch_responseid
// Tabellen er oprettet med cachedtokens og reasoningtokens som tekst og
// opfoelgning som heltal (1 = opfølgning, 0 = ny samtale) – det skrives sådan.
//
// Logningen må aldrig få selve AI-kaldet til at fejle.

const { dvFetch } = require("./_dv");

const ENTITY_SET = process.env.AI_LOG_ENTITY_SET || "cr175_lch_ai_forbrugs";
const cut = (v, n) => String(v ?? "").substring(0, n);
const num = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

// Svar-id'er, der allerede er logget på denne instans (baggrundskald pollers
// flere gange – kun det færdige svar logges, og kun én gang).
const logged = new Set();

function userEmail(req) {
  try {
    const cp = JSON.parse(Buffer.from(req.headers["x-ms-client-principal"] || "", "base64").toString("utf8"));
    const claims = Array.isArray(cp.claims) ? cp.claims : [];
    const claim = t => claims.find(c => c.typ === t)?.val;
    return String(claim("preferred_username") || claim("upn") || cp.userDetails || "").toLowerCase();
  } catch {
    return "";
  }
}

// usage fra OpenAI Responses API ({ input_tokens, output_tokens, ... }) eller
// fra transcriptions ({ input_tokens, output_tokens, total_tokens })
function parseUsage(u) {
  const input = num(u?.input_tokens ?? u?.prompt_tokens);
  const output = num(u?.output_tokens ?? u?.completion_tokens);
  return {
    input,
    cached: num(u?.input_tokens_details?.cached_tokens ?? u?.prompt_tokens_details?.cached_tokens),
    output,
    reasoning: num(u?.output_tokens_details?.reasoning_tokens ?? u?.completion_tokens_details?.reasoning_tokens),
    total: num(u?.total_tokens) || input + output
  };
}

function tidTekst(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

/**
 * logAi(context, req, { kilde, opgave, model, usage, billeder, opfoelgning, responseId })
 * Returnerer aldrig en fejl – skriver kun en advarsel i loggen.
 */
async function logAi(context, req, info = {}) {
  try {
    const rid = cut(info.responseId, 100);
    if (rid) {
      if (logged.has(rid)) return;
      logged.add(rid);
      if (logged.size > 5000) logged.clear();
    }
    const u = parseUsage(info.usage || {});
    const billeder = num(info.billeder);
    if (!u.total && !billeder) return;          // intet forbrug at logge

    const email = userEmail(req);
    const now = new Date();
    await dvFetch(ENTITY_SET, {
      method: "POST",
      body: {
        cr175_lch_name: cut(`${info.kilde || "ai"} ${email || "ukendt"} ${tidTekst(now)}`, 100),
        cr175_lch_useremail: cut(email, 100),
        cr175_lch_tidspunkt: now.toISOString(),
        cr175_lch_kilde: cut(info.kilde || "ai", 50),
        cr175_lch_opgave: cut(info.opgave || "", 50),
        cr175_lch_model: cut(info.model || "", 100),
        cr175_lch_inputtokens: u.input,
        cr175_lch_cachedtokens: String(u.cached),
        cr175_lch_outputtokens: u.output,
        cr175_lch_reasoningtokens: String(u.reasoning),
        cr175_lch_totaltokens: u.total,
        cr175_lch_billeder: billeder,
        cr175_lch_opfoelgning: info.opfoelgning === true ? 1 : 0,
        cr175_lch_responseid: rid
      }
    });
  } catch (e) {
    context?.log?.warn ? context.log.warn("AI-log fejlede:", e.message) : console.warn("AI-log fejlede:", e.message);
  }
}

module.exports = { logAi, parseUsage, ENTITY_SET };
