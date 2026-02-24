const { dvFetch } = require("../_dv");

const TABLE = "lch_portallinks"; // Dataverse entity set name (ofte plural!)
const IDCOL = "lch_portallinkid"; // primærnøgle (tjek i Dataverse)
function json(context, status, body){
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

// Hjælper: map DV -> frontend
function mapOut(r){
  return {
    id: r[IDCOL],
    title: r.lch_title || "",
    url: r.lch_url || "",
    icon: r.lch_icon || "",
    category: r.lch_category || "",
    group: r.lch_group || "",
    parent: r.lch_parent || null,
    allowedRoles: r.lch_allowedroles || "",
    enabled: r.lch_enabled !== false,
    sort: r.lch_sortorder ?? 1000,
    openMode: r.lch_openmode || "newTab"
  };
}

module.exports = async function (context, req) {
  try {
    const m = (req.method || "GET").toUpperCase();

    if (m === "GET") {
      const data = await dvFetch(`${TABLE}?$select=${IDCOL},lch_title,lch_url,lch_icon,lch_category,lch_group,lch_parent,lch_allowedroles,lch_enabled,lch_sortorder,lch_openmode`);
      return json(context, 200, (data.value || []).map(mapOut));
    }

    if (m === "POST") {
      const b = req.body || {};
      const payload = {
        lch_title: b.title || "",
        lch_url: b.url || "",
        lch_icon: b.icon || "",
        lch_category: b.category || "",
        lch_group: b.group || "",
        lch_parent: b.parent || null,
        lch_allowedroles: b.allowedRoles || "",
        lch_enabled: b.enabled !== false,
        lch_sortorder: Number(b.sort ?? 1000),
        lch_openmode: b.openMode || "newTab"
      };
      await dvFetch(`${TABLE}`, { method: "POST", body: payload });
      // hent igen (simpelt)
      const data = await dvFetch(`${TABLE}?$top=1&$orderby=createdon desc&$select=${IDCOL},lch_title,lch_url,lch_icon,lch_category,lch_group,lch_parent,lch_allowedroles,lch_enabled,lch_sortorder,lch_openmode`);
      return json(context, 200, mapOut(data.value[0]));
    }

    if (m === "PUT") {
      const b = req.body || {};
      if (!b.id) return json(context, 400, { error:"missing_id" });

      const payload = {
        lch_title: b.title || "",
        lch_url: b.url || "",
        lch_icon: b.icon || "",
        lch_category: b.category || "",
        lch_group: b.group || "",
        lch_parent: b.parent || null,
        lch_allowedroles: b.allowedRoles || "",
        lch_enabled: b.enabled !== false,
        lch_sortorder: Number(b.sort ?? 1000),
        lch_openmode: b.openMode || "newTab"
      };

      await dvFetch(`${TABLE}(${b.id})`, { method: "PATCH", body: payload });
      return json(context, 200, { ok:true });
    }

    if (m === "DELETE") {
      const id = req.query?.id;
      if (!id) return json(context, 400, { error:"missing_id" });
      await dvFetch(`${TABLE}(${id})`, { method: "DELETE" });
      return json(context, 200, { ok:true });
    }

    return json(context, 405, { error:"method_not_allowed" });
  } catch (e) {
    return json(context, e.status || 500, { error:"server_error", message: e.message, data: e.data });
  }
};
