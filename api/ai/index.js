const fetch = globalThis.fetch;

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body
  };
}

const TASKS = {
  rewrite: "Ret stavefejl, grammatik og dårlig formulering. Bevar betydningen. Returner som udgangspunkt kun den forbedrede tekst, medmindre noget er uklart.",
  improve: "Forbedr formuleringen, så teksten bliver tydelig, naturlig og velskrevet. Bevar betydningen.",
  professional: "Omskriv teksten, så den fremstår professionel, troværdig og tydelig uden at blive stiv eller kunstig.",
  informal: "Omskriv teksten i en mere uformel, naturlig og kollegial tone. Bevar betydningen og undgå slang, medmindre brugeren selv bruger det.",
  email: "Omskriv indholdet til en venlig, tydelig og professionel mail. Medtag kun emnelinje, hvis det er nyttigt.",
  email_reply: "Skriv et passende svar på den mail eller tekst, brugeren indsætter. Svar skal kunne bruges direkte efter let tilpasning.",
  summarize: "Opsummer indholdet klart og struktureret på samme sprog som inputtet.",
  translate: "Oversæt brugerens tekst korrekt og naturligt. Bevar betydning, navne, tal og relevant formatering.",
  explain: "Forklar indholdet praktisk og letforståeligt på samme sprog som brugeren.",
  bullets: "Omskriv indholdet til en overskuelig punktliste uden at opfinde nye oplysninger.",
  free: "Besvar brugerens spørgsmål hjælpsomt, konkret og på samme sprog som brugeren."
};

const OPTION_PROMPTS = {
  rewrite: {
    tone: {
      preserve: "Bevar tekstens nuværende tone så tæt som muligt.",
      professional: "Gør samtidig tonen mere professionel.",
      natural: "Gør samtidig sproget mere naturligt og flydende."
    }
  },
  improve: {
    tone: {
      neutral: "Brug en neutral og naturlig tone.",
      professional: "Brug en professionel tone.",
      informal: "Brug en mere uformel og kollegial tone."
    },
    length: {
      shorter: "Gør teksten kortere og mere præcis.",
      same: "Bevar omtrent samme længde som originalen.",
      detailed: "Du må gerne gøre teksten lidt mere uddybende, hvis det forbedrer forståelsen."
    }
  },
  professional: {
    audience: {
      colleague: "Skriv til en intern kollega.",
      customer: "Skriv med en kunde som målgruppe.",
      management: "Skriv med ledelse eller beslutningstagere som målgruppe."
    }
  },
  email: {
    recipient: {
      internal: "Mailen er til en intern kollega.",
      customer: "Mailen er til en kunde.",
      supplier: "Mailen er til en leverandør eller ekstern samarbejdspartner."
    },
    length: {
      short: "Hold mailen kort og direkte.",
      normal: "Brug en normal, passende længde.",
      detailed: "Gør mailen mere uddybende og forklarende."
    }
  },
  email_reply: {
    intent: {
      accept: "Svar positivt og accepter det, afsenderen foreslår eller spørger om.",
      reject: "Skriv et afslag eller en afvisning på en ordentlig måde.",
      clarify: "Svar ved at bede om de nødvendige oplysninger eller afklaringer.",
      neutral: "Skriv et neutralt, sagligt svar baseret på indholdet."
    },
    rejectTone: {
      friendly: "Afslaget skal være venligt og imødekommende.",
      firm: "Afslaget skal være tydeligt og bestemt, men stadig professionelt."
    }
  },
  summarize: {
    compression: {
      light: "Komprimer let. Bevar næsten alle væsentlige detaljer, nuancer og forklaringer, men fjern gentagelser og fyld.",
      medium: "Komprimer middel. Bevar hovedpointerne og de vigtigste detaljer, men forkort tydeligt.",
      heavy: "Komprimer meget. Returner kun de vigtigste pointer, konklusioner og nødvendige fakta."
    }
  },
  translate: {
    language: {
      da: "Oversæt til dansk.",
      en: "Oversæt til engelsk.",
      de: "Oversæt til tysk.",
      nl: "Oversæt til hollandsk.",
      ro: "Oversæt til rumænsk.",
      uk: "Oversæt til ukrainsk.",
      fr: "Oversæt til fransk.",
      es: "Oversæt til spansk.",
      pl: "Oversæt til polsk."
    },
    tone: {
      preserve: "Bevar originalens tone og stil.",
      professional: "Brug en professionel og naturlig tone på målsproget.",
      natural: "Prioriter et naturligt og flydende sprog frem for en ordret oversættelse."
    }
  },
  explain: {
    level: {
      simple: "Forklar det meget enkelt og uden unødvendige fagudtryk.",
      normal: "Forklar det i et normalt detaljeniveau for en almindelig kollega.",
      technical: "Forklar det mere teknisk og detaljeret, og brug relevante fagbegreber."
    }
  },
  bullets: {
    detail: {
      short: "Lav en kort punktliste med kun de vigtigste punkter.",
      detailed: "Lav en mere detaljeret punktliste, hvor væsentlige underpunkter bevares."
    },
    headings: {
      yes: "Brug korte overskrifter til at gruppere punkterne, når det giver mening.",
      no: "Brug kun punkter uden ekstra overskrifter."
    }
  }
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

function optionInstructions(task, options) {
  const taskOptions = OPTION_PROMPTS[task] || {};
  const input = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const out = [];
  for (const [key, value] of Object.entries(input)) {
    const prompt = taskOptions?.[key]?.[String(value)];
    if (prompt) out.push(prompt);
  }
  return out;
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
  const options = body.options && typeof body.options === "object" ? body.options : {};

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
    "Svar som udgangspunkt på samme sprog som brugeren, medmindre opgaven er oversættelse.",
    "Vær konkret og brugbar. Opfind ikke fakta, hvis information mangler.",
    "Når dette er en opfølgning, skal du bruge den tidligere samtale som kontekst og forstå henvisninger som 'den', 'det', 'ovenstående' og lignende ud fra samtalen.",
    TASKS[task],
    ...optionInstructions(task, options)
  ].join(" ");

  try {
    const requestBody = {
      model: process.env.CHATGTP_AI_MODEL || "gpt-5.6",
      instructions,
      input: [{ role: "user", content }],
      max_output_tokens: 2500
    };
    if (previousResponseId) requestBody.previous_response_id = previousResponseId;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
    if (!answer) return json(context, 502, { error: "empty_response", message: "AI returnerede ikke noget tekstsvar." });

    return json(context, 200, { answer, responseId: data.id || null });
  } catch (e) {
    context.log("AI endpoint fejl:", e.message);
    return json(context, 500, { error: "ai_failed", message: e.message });
  }
};
