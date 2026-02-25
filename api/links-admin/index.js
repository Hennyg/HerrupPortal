const { dvFetch } = require("../_dv");

const TABLE = "cr175_lch_portallinks";
const ID = "cr175_lch_portallinkid";
function json(context, status, body){
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

// Hjælper: map DV -> frontend
function mapOut(r){
  return {
    id: r[IDCOL],
    title: r.cr175_lch_title || "",
    url: r.cr175_lch_url || "",
    icon: r.cr175_lch_icon || "",
    category: r.cr175_lch_category || "",
    group: r.cr175_lch_group || "",
    parent: r.cr175_lch_parent || null,
    allowedRoles: r.cr175_lch_allowedroles || "",
    enabled: r.cr175_lch_enabled !== false,
    sort: r.cr175_lch_sortorder ?? 1000,
    openMode: r.cr175_lch_openmode || "newTab"
  };
}

module.exports = async function (context, req) {
  try {
    const m = (req.method || "GET").toUpperCase();

    if (m === "GET") {
      const data = await dvFetch(`${TABLE}?$select=${IDCOL},cr175_lch_title,cr175_lch_url,cr175_lch_icon,cr175_lch_category,cr175_lch_group,cr175_lch_parent,cr175_lch_allowedroles,cr175_lch_enabled,cr175_lch_sortorder,cr175_lch_openmode`);
      return json(context, 200, (data.value || []).map(mapOut));
    }

    if (m === "POST") {
      const b = req.body || {};
      const payload = {
        lch_title: b.cr175_lch_title || "",
        lch_url: b.cr175_lch_url || "",
        lch_icon: b.cr175_lch_icon || "",
        lch_category: b.cr175_lch_category || "",
        lch_group: b.cr175_lch_group || "",
        lch_parent: b.cr175_lch_parent || null,
        lch_allowedroles: b.cr175_lch_allowedRoles || "",
        lch_enabled: b.cr175_lch_enabled !== false,
        lch_sortorder: Number(b.cr175_lch_sort ?? 1000),
        lch_openmode: b.cr175_lch_openMode || "newTab"
      };
      await dvFetch(`${TABLE}`, { method: "POST", body: payload });
      // hent igen (simpelt)
      const data = await dvFetch(`${TABLE}?$top=1&$orderby=createdon desc&$select=${IDCOL},cr175_lch_title,cr175_lch_url,cr175_lch_icon,cr175_lch_category,cr175_lch_group,cr175_lch_parent,cr175_lch_allowedroles,cr175_lch_enabled,cr175_lch_sortorder,cr175_lch_openmode`);
      return json(context, 200, mapOut(data.value[0]));
    }

    if (m === "PUT") {
      const b = req.body || {};
      if (!b.id) return json(context, 400, { error:"missing_id" });

      const payload = {
        lch_title: b.cr175_lch_title || "",
        lch_url: b.cr175_lch_url || "",
        lch_icon: b.cr175_lch_icon || "",
        lch_category: b.cr175_lch_category || "",
        lch_group: b.cr175_lch_group || "",
        lch_parent: b.cr175_lch_parent || null,
        lch_allowedroles: b.cr175_lch_allowedRoles || "",
        lch_enabled: b.cr175_lch_enabled !== false,
        lch_sortorder: Number(b.cr175_lch_sort ?? 1000),
        lch_openmode: b.cr175_lch_openMode || "newTab"
      };

      await dvFetch(`${TABLE}(${b.cr175_lch_id})`, { method: "PATCH", body: payload });
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
