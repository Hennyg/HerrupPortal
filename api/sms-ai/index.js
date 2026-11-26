// /api/sms-ai/index.js
// Kontrollerer en SMS-tekst:
//  1) Tegn uden for GSM-tegnsættet (fx ’ “ – … og emojis), som gør, at hver SMS
//     kun kan være 70 tegn i stedet for 160. Findes uden AI, så de altid fanges.
//  2) Sproglige forslag fra AI (stavning, grammatik, kortere/klarere formulering).
//   POST { message }  →  { suggestions: [{ id, type, find, replace, all, reason }], before, after }
const fetch = globalThis.fetch;
const S = require("../_sms");
const { logAi } = require("../_aiLog");   // tokenforbrug pr. kald (ikke indholdet)

// Almindelige tegn, der ikke er i GSM-7, og hvad de bør erstattes med.
const CHAR_MAP = {
  "\u2019": "'", "\u2018": "'", "\u201A": "'", "\u00B4": "'", "`": "'",
  "\u201C": "\"", "\u201D": "\"", "\u201E": "\"", "\u00AB": "\"", "\u00BB": "\"",
  "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u2010": "-", "\u2011": "-",
  "\u2026": "...", "\u00A0": " ", "\u2009": " ", "\u202F": " ", "\u200B": "",
  "\u2022": "-", "\u00B7": "-", "\t": " ",
  "\u00E1": "a", "\u00E2": "a", "\u00E3": "a", "\u00ED": "i", "\u00EE": "i", "\u00EF": "i",
  "\u00F3": "o", "\u00F4": "o", "\u00F5": "o", "\u00FA": "u", "\u00FB": "u", "\u00EA": "e", "\u00EB": "e",
  "\u00C1": "A", "\u00C0": "A", "\u00C2": "A", "\u00CD": "I", "\u00D3": "O", "\u00DA": "U", "\u00C8": "E", "\u00CA": "E",
  "\u00E7": "c", "\uFE0F": "", "\u200D": "", "\u00B0": " grader", "\u00BD": "1/2", "\u00BC": "1/4", "\u2122": "", "\u00AE": "", "\u00A9": "(c)"
};

function charName(ch) {
  const names = {
    "\u2019": "skævt apostrof", "\u2018": "skævt apostrof", "\u00B4": "accent", "`": "accent",
    "\u201C": "skævt anførselstegn", "\u201D": "skævt anførselstegn", "\u201E": "skævt anførselstegn",
    "\u2013": "lang tankestreg", "\u2014": "lang tankestreg", "\u2026": "ellipse-tegn",
    "\u00A0": "hårdt mellemrum", "\u200B": "usynligt tegn", "\uFE0F": "usynligt tegn", "\u200D": "usynligt tegn", "\u2022": "punkttegn", "\t": "tabulator"
  };
  return names[ch] || `tegnet "${ch}"`;
}

function charSuggestions(text) {
  const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const GSM_EXT = "^{}\\[~]|€";
  const counts = new Map();
  for (const ch of String(text || "")) {
    if (GSM_BASIC.includes(ch) || GSM_EXT.includes(ch)) continue;
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  const out = [];
  for (const [ch, n] of counts) {
    const repl = Object.prototype.hasOwnProperty.call(CHAR_MAP, ch) ? CHAR_MAP[ch] : "";
    const isEmoji = /\p{Extended_Pictographic}/u.test(ch);
    const label = isEmoji ? "Emoji" : charName(ch).replace(/^./, c => c.toUpperCase());
    out.push({
      type: "tegn",
      find: ch,
      replace: repl,
      all: true,
      reason: `${label} (${n} gang${n > 1 ? "e" : ""}) er ikke et standard SMS-tegn og gør, at hver SMS kun kan være 70 tegn. ` +
        (repl ? `Erstat med "${repl}".` : "Fjern tegnet.")
    });
  }
  return out;
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of (data?.output || [])) {
    if (item?.type !== "message") continue;
    for (const c of (item.content || [])) if (c?.type === "output_text" && c.text) parts.push(c.text);
  }
  return parts.join("\n").trim();
}

async function aiSuggestions(text, apiKey, context, req) {
  const instructions = [
    "Du korrekturlæser SMS-beskeder, som Lely Center Herrup sender til kunder (landmænd) og medarbejdere.",
    "Find stavefejl, grammatikfejl og formuleringer, der kan gøres klarere eller kortere, så SMS'en fylder mindre.",
    "Bevar betydning, tone og alle fakta (datoer, tider, priser, navne, links, telefonnumre) præcis som de er.",
    "Hvert forslag skal have 'find' = en tekst, der står ORDRET i beskeden (kopiér præcist, inkl. store/små bogstaver),",
    "og 'replace' = den nye tekst. Hold 'find' så kort som muligt, men entydigt.",
    "Brug KUN tegn fra GSM-7-tegnsættet i 'replace': ingen skæve anførselstegn, ingen lange tankestreger, ingen emojis.",
    "Skriv 'reason' kort på dansk (maks 15 ord).",
    "Kommenter ikke tegnsætning, der kun er en smagssag. Er teksten fin, så returnér en tom liste.",
    "Maks 8 forslag."
  ].join(" ");

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.CHATGTP_AI_MODEL || "gpt-5.6",
      instructions,
      input: [{ role: "user", content: [{ type: "input_text", text }] }],
      max_output_tokens: 1500,
      text: {
        format: {
          type: "json_schema",
          name: "sms_forslag",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["suggestions"],
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["find", "replace", "reason"],
                  properties: {
                    find: { type: "string" },
                    replace: { type: "string" },
                    reason: { type: "string" }
                  }
                }
              }
            }
          }
        }
      }
    })
  });
  const raw = await r.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI svarede ${r.status}`);
  await logAi(context, req, { kilde: "sms-ai", opgave: "kontrol", model: data.model, usage: data.usage, responseId: data.id });

  let parsed = null;
  const out = extractOutputText(data).replace(/^```json|```$/g, "").trim();
  try { parsed = JSON.parse(out); } catch { parsed = null; }
  const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  // Kun forslag, hvor teksten faktisk findes, og som ændrer noget.
  return list
    .filter(x => x && typeof x.find === "string" && x.find && text.includes(x.find) && x.find !== x.replace)
    .slice(0, 8)
    .map(x => ({ type: "sprog", find: x.find, replace: String(x.replace ?? ""), all: false, reason: String(x.reason || "").slice(0, 200) }));
}

module.exports = async function (context, req) {
  const user = await S.requireAccess(context, req);
  if (!user) return;

  const text = String(req.body?.message || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return S.json(context, 400, { error: "Beskeden er tom" });
  if (text.length > 2000) return S.json(context, 400, { error: "Beskeden er for lang til kontrol (maks 2000 tegn)" });

  const chars = charSuggestions(text);

  let lang = [], aiError = null;
  const apiKey = process.env.CHATGTP_AI_KEY;
  if (!apiKey) {
    aiError = "Mangler app setting: CHATGTP_AI_KEY";
  } else {
    try {
      lang = await aiSuggestions(text, apiKey, context, req);
    } catch (e) {
      aiError = e.message;
      context.log.warn("sms-ai:", e.message);
    }
  }

  const suggestions = [...chars, ...lang].map((s, i) => ({ id: `s${i + 1}`, ...s }));
  return S.json(context, 200, { suggestions, aiError, before: S.smsInfo(text) });
};
