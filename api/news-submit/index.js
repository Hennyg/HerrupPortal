// /api/news-submit – en medarbejder indsender en nyhed til godkendelse.
// Nyheden gemmes med status "Afventer" og er ikke synlig, før en person med
// portal_admin eller portal_hp_nyheder godkender den i nyheder-admin.html.
const fetch = globalThis.fetch;
const N = require("../_news");
const { T } = N;

async function displayName(user) {
  // Fulde navn fra Graph (claims er tomme i backend'en) – ikke kritisk
  try {
    const r = await fetch(`https://login.microsoftonline.com/${process.env.DV_TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.DV_CLIENT_ID,
        client_secret: process.env.DV_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default"
      })
    });
    const t = await r.json();
    const u = await fetch(`https://graph.microsoft.com/v1.0/users/${user.userId}?$select=displayName`, {
      headers: { Authorization: `Bearer ${t.access_token}` }
    }).then(x => x.json());
    return u.displayName || "";
  } catch {
    return "";
  }
}

module.exports = async function (context, req) {
  const user = N.getPrincipal(req);
  if (!user) return N.json(context, 401, { error: "Ikke logget ind" });

  try {
    const b = req.body || {};
    const overskrift = String(b.overskrift || "").trim().slice(0, 200);
    const indhold = String(b.indhold || "").trim();
    if (!overskrift) return N.json(context, 400, { error: "Skriv en overskrift" });
    if (!indhold) return N.json(context, 400, { error: "Skriv en kort besked" });

    const brodtekst = N.cleanHtml(b.brodtekst);
    const name = await displayName(user);
    const indsender = name ? `${name} <${user.email}>` : user.email;

    const res = await N.dv(N.TIP_SET, {
      method: "POST",
      body: {
        [T.valg]: N.VALG.nyhed,
        [T.overskrift]: overskrift,
        [T.indhold]: indhold,
        [T.brodtekst]: brodtekst,
        [T.aktiv]: "Afventer",
        [T.indsender]: indsender.slice(0, 200)
      }
    });

    if (res?.id) {
      try { await N.syncImages(res.id, brodtekst); } catch { /* billeder knyttes ved godkendelse */ }
    }
    return N.json(context, 200, { ok: true, id: res?.id || null });
  } catch (e) {
    context.log.error("news-submit:", e);
    return N.json(context, 500, { error: e.message });
  }
};
