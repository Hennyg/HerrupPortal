// /api/sms-balance/index.js
// Antal SMS tilbage på Sveve-kontoen.
const S = require("../_sms");

module.exports = async function (context, req) {
  const user = await S.requireAccess(context, req);
  if (!user) return;
  try {
    const b = await S.sveveBalance();
    return S.json(context, 200, { count: b.count, raw: b.count === null ? b.raw : undefined, price: S.SMS_PRICE });
  } catch (e) {
    return S.json(context, 502, { error: e.message });
  }
};
