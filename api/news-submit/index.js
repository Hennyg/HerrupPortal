// /api/news-submit – en medarbejder indsender en nyhed til godkendelse.
// Nyheden gemmes med status "Afventer" og er ikke synlig, før en redaktør
// (se EDITOR_ROLES i _news.js) godkender den i nyheder-admin.html.
// Indsenderen kan sætte datoer, men ikke nyhedsbjælke – det gør redaktøren.
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

// "YYYY-MM-DD" eller null. Fejl med userError, så brugeren får en pæn besked.
function normDate(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) {
    throw Object.assign(new Error("Ugyldig dato"), { userError: true });
  }
  return s;
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

    let udlobsdato, slutdato;
    try {
      udlobsdato = normDate(b.udlobsdato);
      slutdato = normDate(b.slutdato);
    } catch (e) {
      return N.json(context, 400, { error: e.message });
    }
    if (udlobsdato && slutdato && udlobsdato > slutdato) {
      return N.json(context, 400, { error: "“Vis på forsiden til og med” kan ikke ligge efter “Fjern nyheden helt efter”" });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (slutdato && slutdato < today) {
      return N.json(context, 400, { error: "“Fjern nyheden helt efter” ligger i fortiden" });
    }

    const brodtekst = N.cleanHtml(b.brodtekst);
    let videourl = "";
    try {
      videourl = (await N.resolveVideoLink(b.videourl)).embed;
    } catch (e) {
      if (e.userError) return N.json(context, 400, { error: e.message });
      throw e;
    }
    const name = await displayName(user);
    const indsender = name ? `${name} <${user.email}>` : user.email;

    const res = await N.dv(N.TIP_SET, {
      method: "POST",
      body: {
        [T.valg]: N.VALG.nyhed,
        [T.overskrift]: overskrift,
        [T.indhold]: indhold,
        [T.brodtekst]: brodtekst,
        [T.videourl]: videourl || null,
        [T.udlobsdato]: udlobsdato,
        [T.slutdato]: slutdato,
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
