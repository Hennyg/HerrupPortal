// /api/sms-log/index.js
// Historik over sendte SMS'er fra Dataverse. ?top=200 (maks 1000)
const S = require("../_sms");
const C = S.COL;

module.exports = async function (context, req) {
  const user = await S.requireAccess(context, req);
  if (!user) return;
  try {
    const top = Math.min(Math.max(parseInt(req.query.top, 10) || 200, 1), 1000);
    const select = [S.IDCOL, C.titel, C.modtagere, C.besked, C.afsender, C.afsenderMail, C.fra,
      C.test, C.antalSms, C.antalModtagere, C.sendt, C.status, "createdon"].join(",");
    const data = await S.dvFetch(`${S.TABLE}?$select=${select}&$orderby=${C.sendt} desc,createdon desc&$top=${top}`);
    const items = (data?.value || []).map(r => ({
      id: r[S.IDCOL],
      titel: r[C.titel] || "",
      modtagere: r[C.modtagere] || "",
      besked: r[C.besked] || "",
      afsender: r[C.afsender] || "",
      afsenderMail: r[C.afsenderMail] || "",
      fra: r[C.fra] || "",
      test: r[C.test] === true,
      antalSms: r[C.antalSms] ?? null,
      antalModtagere: r[C.antalModtagere] ?? null,
      sendt: r[C.sendt] || r.createdon || null,
      status: r[C.status] || ""
    }));
    return S.json(context, 200, { items, price: S.SMS_PRICE, isAdmin: user.roles.some(r => S.ADMIN_ROLES.includes(r)) });
  } catch (e) {
    context.log.error("sms-log:", e);
    return S.json(context, 500, { error: e.message });
  }
};
