// /api/news-video – omsætter et OneDrive-delingslink til en integrerings-URL,
// så videoen kan vises på siden. POST { url } → { embed, name }
const N = require("../_news");

module.exports = async function (context, req) {
  if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });
  try {
    const r = await N.resolveVideoLink(req.body?.url);
    return N.json(context, 200, r);
  } catch (e) {
    if (e.userError) return N.json(context, 400, { error: e.message });
    context.log.error("news-video:", e);
    return N.json(context, 500, { error: e.message });
  }
};
