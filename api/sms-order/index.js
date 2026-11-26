// /api/sms-order/index.js
// Bestiller flere SMS'er hos Sveve. Kun admin.
//   POST { count }  →  { ok, count, svar }
const S = require("../_sms");

const MIN = 100;
const MAX = 100000;

module.exports = async function (context, req) {
  const user = await S.requireAccess(context, req, { admin: true });
  if (!user) return;

  const count = Number(String(req.body?.count ?? "").replace(/[\s.]/g, ""));
  if (!Number.isInteger(count) || count < MIN || count > MAX) {
    return S.json(context, 400, { error: `Antal skal være et helt tal mellem ${MIN} og ${MAX.toLocaleString("da-DK")}` });
  }

  try {
    const r = await S.sveveOrder(count);
    // Sveve svarer med tekst – en fejl indeholder typisk "error"/"fejl".
    const failed = /error|fejl|invalid|ugyldig/i.test(r.raw);
    context.log(`sms-order: ${user.email} bestilte ${count} SMS'er – svar: ${r.raw}`);
    return S.json(context, failed ? 502 : 200, {
      ok: !failed,
      count,
      svar: r.raw,
      error: failed ? `Sveve afviste bestillingen: ${r.raw}` : null
    });
  } catch (e) {
    context.log.error("sms-order:", e);
    return S.json(context, 502, { error: e.message });
  }
};
