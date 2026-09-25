// /api/news-ai – laver en meget kort oversigt over de vigtigste punkter i
// "Hele teksten", til feltet "Kort besked". Samme OpenAI-opsætning som /api/ai.
//   POST { text, overskrift, maxChars }  →  { summary }
const fetch = globalThis.fetch;
const N = require("../_news");

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of (data?.output || [])) {
    if (item?.type !== "message") continue;
    for (const c of (item.content || [])) if (c?.type === "output_text" && c.text) parts.push(c.text);
  }
  return parts.join("\n").trim();
}

module.exports = async function (context, req) {
  if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });

  const apiKey = process.env.CHATGTP_AI_KEY;
  if (!apiKey) return N.json(context, 500, { error: "Mangler app setting: CHATGTP_AI_KEY" });

  const b = req.body || {};
  const text = String(b.text || "").trim();
  const overskrift = String(b.overskrift || "").trim().slice(0, 200);
  const maxChars = Math.min(Math.max(parseInt(b.maxChars, 10) || 250, 60), 400);

  if (text.length < 40) return N.json(context, 400, { error: "Der er for lidt tekst i “Hele teksten” til en oversigt" });
  if (text.length > 30000) return N.json(context, 400, { error: "Teksten er for lang (maks 30.000 tegn)" });

  const instructions = [
    "Du skriver korte nyhedsresuméer til forsiden af Herrup Portalen, intranettet hos Lely Center Herrup.",
    "Lav en meget kort oversigt over de vigtigste punkter i teksten – typisk et referat fra et fællesmøde.",
    `Svaret må højst være ${maxChars} tegn.`,
    "Skriv på dansk som én linje, hvor punkterne er adskilt af ' · '. Brug 3-5 punkter.",
    "Ingen indledning, ingen overskrift, ingen punkttegn, ingen anførselstegn og ingen afsluttende bemærkning.",
    "Opfind ikke noget, der ikke står i teksten."
  ].join(" ");

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.CHATGTP_AI_MODEL || "gpt-5.6",
        instructions,
        input: [{ role: "user", content: [{ type: "input_text", text: (overskrift ? `Overskrift: ${overskrift}\n\n` : "") + text }] }],
        max_output_tokens: 600
      })
    });
    const raw = await r.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!r.ok) return N.json(context, 502, { error: data?.error?.message || `OpenAI svarede ${r.status}` });

    let summary = extractOutputText(data).replace(/\s*\n+\s*/g, " · ").replace(/^["'“”]+|["'“”]+$/g, "").trim();
    if (!summary) return N.json(context, 502, { error: "AI returnerede ikke noget svar" });
    if (summary.length > maxChars) summary = summary.slice(0, maxChars - 1).replace(/\s+\S*$/, "") + "…";
    return N.json(context, 200, { summary });
  } catch (e) {
    context.log.error("news-ai:", e);
    return N.json(context, 500, { error: e.message });
  }
};
