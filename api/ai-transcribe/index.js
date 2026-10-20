// api/ai-transcribe/index.js
//
// Transskriberer ét lydstykke via OpenAI (gpt-4o-transcribe).
// Browseren (ai.js) deler store lydfiler op i stykker af ca. 1 minut.
//
// POST /api/ai-transcribe   body (JSON): { name, mime, data }  – data er base64
// App settings: CHATGTP_AI_KEY, valgfri CHATGTP_TRANSCRIBE_MODEL

const MAX_BYTES = 24 * 1024 * 1024;
const OPENAI_TIMEOUT_MS = 40000; // under SWA's 45 sek., så vi selv når at svare med en fejl
const ALLOWED_EXT = ["flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "oga", "ogg", "wav", "webm"];

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body
  };
}

function readBody(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString("utf8");
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch { b = null; }
  }
  return b && typeof b === "object" ? b : {};
}

module.exports = async function (context, req) {
  const t0 = Date.now();
  let timer = null;

  try {
    if (!req.headers["x-ms-client-principal"]) {
      return json(context, 401, { error: "unauthorized", message: "Ikke logget ind" });
    }

    const apiKey = process.env.CHATGTP_AI_KEY;
    if (!apiKey) {
      return json(context, 500, { error: "missing_setting", message: "Mangler SWA app setting: CHATGTP_AI_KEY" });
    }

    if (typeof FormData === "undefined" || typeof Blob === "undefined") {
      return json(context, 500, { error: "runtime", message: `Node ${process.version} mangler FormData/Blob – kræver Node 18+` });
    }

    const body = readBody(req);
    const buf = Buffer.from(String(body.data || ""), "base64");
    if (!buf.length) return json(context, 400, { error: "empty_audio", message: "Der blev ikke modtaget nogen lyd." });
    if (buf.length > MAX_BYTES) {
      return json(context, 413, { error: "audio_too_large", message: "Lydstykket er større end 24 MB." });
    }

    let name = String(body.name || "lyd.wav").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) name = `${name}.wav`;
    const mime = String(body.mime || "application/octet-stream");

    const form = new FormData();
    form.append("file", new Blob([buf], { type: mime }), name);
    form.append("model", process.env.CHATGTP_TRANSCRIBE_MODEL || "gpt-4o-transcribe");
    form.append("response_format", "json");

    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS);

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: ctrl.signal
    });

    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }

    context.log(`ai-transcribe ${name}: ${buf.length} bytes, ${Date.now() - t0} ms, status ${r.status}`);

    if (!r.ok) {
      return json(context, 502, {
        error: "openai_error",
        message: data?.error?.message || `OpenAI returnerede ${r.status}`
      });
    }

    return json(context, 200, { text: String(data.text || "").trim() });
  } catch (e) {
    if (e && e.name === "AbortError") {
      return json(context, 504, {
        error: "transcribe_timeout",
        message: `OpenAI svarede ikke inden for ${OPENAI_TIMEOUT_MS / 1000} sek.`
      });
    }
    context.log("ai-transcribe fejl:", e);
    return json(context, 500, { error: "transcribe_failed", message: String(e?.message || e) });
  } finally {
    if (timer) clearTimeout(timer);
  }
};
