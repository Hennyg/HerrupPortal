const fetch = globalThis.fetch;

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body
  };
}

const TASKS = {
  rewrite: "Ret stavefejl, grammatik og dårlig formulering. Bevar betydning og tone. Returnér kun den forbedrede tekst, medmindre noget er uklart.",
  improve: "Omskriv teksten, så den bliver tydelig, professionel og naturlig på samme sprog som inputtet. Bevar betydningen.",
  email: "Omskriv indholdet til en venlig, tydelig og professionel mail. Brug samme sprog som inputtet.",
  summarize: "Lav en kort og overskuelig opsummering af indholdet. Brug samme sprog som inputtet.",
  explain: "Forklar indholdet enkelt og praktisk, så en almindelig kollega nemt kan forstå det. Brug samme sprog som inputtet.",
  free: "Besvar brugerens spørgsmål hjælpsomt, kortfattet og på samme sprog som brugeren."
};

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of (data?.output || [])) {
    if (item?.type !== "message") continue;
    for (const content of (item.content || [])) {
      if (content?.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function validResponseId(value) {
  const id = String(value || "").trim();
  return /^resp_[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  const apiKey = process.env.CHATGTP_AI_KEY;
  if (!apiKey) {
    return json(context, 500, { error: "missing_setting", message: "Mangler SWA app setting: CHATGTP_AI_KEY" });
  }

  const body = req.body || {};
  const task = TASKS[body.task] ? body.task : "free";
  const prompt = String(body.prompt || "").trim();
  const images = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  const previousResponseId = validResponseId(body.previousResponseId);

  if (!prompt && images.length === 0) {
    return json(context, 400, { error: "empty_input", message: "Skriv et spørgsmål eller tilføj et billede." });
  }
  if (prompt.length > 30000) {
    return json(context, 400, { error: "input_too_long", message: "Teksten er for lang. Del den op i mindre dele." });
  }

  const content = [];
  if (prompt) content.push({ type: "input_text", text: prompt });

  for (const image of images) {
    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return json(context, 400, { error: "invalid_image", message: "Et af billederne har et ugyldigt format." });
    }
    if (image.length > 5_600_000) {
      return json(context, 400, { error: "image_too_large", message: "Et af billederne er for stort." });
    }
    content.push({ type: "input_image", image_url: image });
  }

  const instructions = [
    "Du er den interne AI-hjælper i Herrup Portalen.",
    "Svar som udgangspunkt på samme sprog som brugeren.",
    "Vær konkret og brugbar. Opfind ikke fakta, hvis information mangler.",
    "Når dette er en opfølgning, skal du bruge den tidligere samtale som kontekst og forstå henvisninger som 'den', 'det', 'ovenstående' og lignende ud fra samtalen.",
    TASKS[task]
  ].join(" ");

  try {
    const requestBody = {
      model: process.env.CHATGTP_AI_MODEL || "gpt-5.6",
      instructions,
      input: [{ role: "user", content }],
      max_output_tokens: 2500
    };

    if (previousResponseId) {
      requestBody.previous_response_id = previousResponseId;
    }

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

    if (!r.ok) {
      context.log("OpenAI API fejl:", r.status, data?.error?.message || text);
      return json(context, 502, {
        error: "openai_error",
        message: data?.error?.message || `OpenAI API returnerede ${r.status}`
      });
    }

    const answer = extractOutputText(data);
    if (!answer) {
      return json(context, 502, { error: "empty_response", message: "AI returnerede ikke noget tekstsvar." });
    }

    return json(context, 200, {
      answer,
      responseId: data.id || null
    });
  } catch (e) {
    context.log("AI endpoint fejl:", e.message);
    return json(context, 500, { error: "ai_failed", message: e.message });
  }
};
