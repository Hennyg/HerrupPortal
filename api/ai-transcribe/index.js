// api/ai-transcribe/index.js
//
// Transskriberer ét lydstykke via OpenAI (gpt-4o-transcribe).
// Browseren (ai.js) deler store lydfiler op i stykker af ca. 2,5 minut,
// så hvert kald holder sig langt under OpenAI's 25 MB-grænse og SWA's
// timeout på managed functions.
//
// POST /api/ai-transcribe?name=del-3.wav   body: rå lyddata (application/octet-stream)
// App settings: CHATGTP_AI_KEY, valgfri CHATGTP_TRANSCRIBE_MODEL

const MAX_BYTES = 24 * 1024 * 1024;
const ALLOWED_EXT = ["flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "oga", "ogg", "wav", "webm"];

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body
  };
}

function bodyBuffer(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.bufferBody && Buffer.isBuffer(req.bufferBody)) return req.bufferBody;
  if (req.body instanceof ArrayBuffer) return Buffer.from(req.body);
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "binary");
  return Buffer.alloc(0);
}

module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  const apiKey = process.env.CHATGTP_AI_KEY;
  if (!apiKey) {
    return json(context, 500, { error: "missing_setting", message: "Mangler SWA app setting: CHATGTP_AI_KEY" });
  }

  const buf = bodyBuffer(req);
  if (!buf.length) return json(context, 400, { error: "empty_audio", message: "Der blev ikke modtaget nogen lyd." });
  if (buf.length > MAX_BYTES) {
    return json(context, 413, { error: "audio_too_large", message: "Lydstykket er større end 24 MB." });
  }

  let name = String(req.query.name || "lyd.wav").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) name = `${name}.wav`;

  const mime = String(req.headers["x-file-type"] || "application/octet-stream");

  try {
    const form = new FormData();
    form.append("file", new Blob([buf], { type: mime }), name);
    form.append("model", process.env.CHATGTP_TRANSCRIBE_MODEL || "gpt-4o-transcribe");
    form.append("response_format", "json");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });

    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }

    if (!r.ok) {
      context.log("OpenAI transcribe fejl:", r.status, data?.error?.message || txt);
      return json(context, 502, {
        error: "openai_error",
        message: data?.error?.message || `OpenAI returnerede ${r.status}`
      });
    }

    return json(context, 200, { text: String(data.text || "").trim() });
  } catch (e) {
    context.log("ai-transcribe fejl:", e.message);
    return json(context, 500, { error: "transcribe_failed", message: e.message });
  }
};
