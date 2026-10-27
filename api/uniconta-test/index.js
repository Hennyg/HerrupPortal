// /api/uniconta-test/index.js
// Kun til admin: udforsk Uniconta-tabeller.
//
// GET /api/uniconta/test?list=1                    → alle tabeller (entity sets) Uniconta udstiller
// GET /api/uniconta/test?list=1&find=TM            → kun tabeller hvis navn indeholder "TM"
// GET /api/uniconta/test?entity=TMJournalLineClient → de første 5 rækker + alle feltnavne
//   valgfrit: &top=20 (maks 50)  &filter=Employee eq 'HN'  &orderby=Date desc
const A = require("../_unicontaAccess");
const { unicontaFetch } = require("../_uniconta");

const ADMIN_ROLES = ["portal_admin", "portal_herrup_portal_admin"];

module.exports = async function (context, req) {
  const user = await A.requireUniconta(context, req);
  if (!user) return;
  if (!user.roles.some(r => ADMIN_ROLES.includes(r))) {
    return A.json(context, 403, { error: "Kræver admin-rolle" });
  }

  try {
    // Liste over tabeller fra OData-servicedokumentet
    if (String(req.query.list || "") === "1") {
      const r = await unicontaFetch("/");
      const data = await r.json();
      const find = String(req.query.find || "").trim().toLowerCase();
      const names = (data.value || [])
        .map(x => x.name || x.url)
        .filter(Boolean)
        .filter(n => !find || n.toLowerCase().includes(find))
        .sort((a, b) => a.localeCompare(b));
      return A.json(context, 200, { count: names.length, entities: names });
    }

    const entity = String(req.query.entity || "").trim();
    if (!/^[A-Za-z0-9_]{2,100}$/.test(entity)) {
      return A.json(context, 400, { error: "Angiv ?entity=Tabelnavn eller ?list=1" });
    }

    const top = Math.min(Math.max(parseInt(req.query.top || "5", 10) || 5, 1), 50);
    const params = [`$top=${top}`];
    const filter = String(req.query.filter || "").trim();
    const orderby = String(req.query.orderby || "").trim();
    if (filter) params.push(`$filter=${encodeURIComponent(filter)}`);
    if (orderby) params.push(`$orderby=${encodeURIComponent(orderby)}`);
    const path = `${entity}?${params.join("&")}`;

    const started = Date.now();
    const r = await unicontaFetch(path);
    const data = await r.json();
    const rows = Array.isArray(data) ? data : (data.value || []);

    const fields = [...new Set(rows.flatMap(row => Object.keys(row || {})))].sort((a, b) => a.localeCompare(b));
    return A.json(context, 200, {
      entity,
      path,
      ms: Date.now() - started,
      count: rows.length,
      fields,
      rows
    });
  } catch (e) {
    context.log.warn("uniconta-test:", e.message);
    // Fejlteksten fra Uniconta sendes med, så man kan se om det er adgang eller tabelnavn
    return A.json(context, 502, { error: e.message });
  }
};
