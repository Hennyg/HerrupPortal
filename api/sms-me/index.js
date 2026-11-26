// /api/sms-me/index.js
// Oplysninger om den indloggede bruger til SMS-siden:
// eget mobilnummer fra Entra (til "Test til dig selv") og om brugeren er admin.
const S = require("../_sms");

module.exports = async function (context, req) {
  const user = await S.requireAccess(context, req);
  if (!user) return;
  let phone = "", phoneRaw = "", phoneError = null;
  try {
    const p = await S.getMyPhone(user);
    phone = p.phone;
    phoneRaw = p.raw;
  } catch (e) {
    phoneError = e.message;
    context.log.warn("sms-me: telefonnummer kunne ikke hentes:", e.message);
  }
  return S.json(context, 200, {
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    phone,
    phoneRaw,
    phoneError
  });
};
