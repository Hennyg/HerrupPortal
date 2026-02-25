// /api/portallinks/index.js (eksempel)
const { dvFetch } = require("../_dv");

// ⚠️ SKAL være EntitySetName fra Dataverse (Web API) – ikke nødvendigvis det du tror
// Eksempel: "cr175_lch_portallinks"
const TABLE = "cr175_lch_portallinks";

// Primary key column (logical name) for rækken
const IDCOL = "cr175_lch_portallinkid";

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body
  };
}

// test 
const data = await dvFetch(
  `EntityDefinitions?$select=LogicalName,EntitySetName&$filter=LogicalName eq 'cr175_lch_portallink'`
);

return json(context, 200, data);

// Hjælper: map DV -> frontend
function mapOut(r) {
  return {
    id: r?.[IDCOL],
    title: r?.cr175_lch_title || "",
    url: r?.cr175_lch_url || "",
    icon: r?.cr175_lch_icon || "",
    category: r?.cr175_lch_category || "",
    group: r?.cr175_lch_group || "",
    parent: r?.cr175_lch_parent || null, // hvis lookup, vil du typisk få _cr175_lch_parent_value i stedet
    allowedRoles: r?.cr175_lch_allowedroles || "",
    enabled: r?.cr175_lch_enabled !== false,
    sort: r?.cr175_lch_sortorder ?? 1000,
    openMode: r?.cr175_lch_openmode || "newTab"
  };
}

module.exports = async function (context, req) {
  try {
    const m = (req.method || "GET").toUpperCase();

    if (m === "GET") {
      const select = [
        IDCOL,
        "cr175_lch_title",
        "cr175_lch_url",
        "cr175_lch_icon",
        "cr175_lch_category",
        "cr175_lch_group",
        "cr175_lch_parent",
        "cr175_lch_allowedroles",
        "cr175_lch_enabled",
        "cr175_lch_sortorder",
        "cr175_lch_openmode"
      ].join(",");

      const data = await dvFetch(`${TABLE}?$select=${select}`);
      return json(context, 200, (data.value || []).map(mapOut));
    }

    if (m === "POST") {
      const b = req.body || {};

      // Bemærk: feltnavne skal matche Dataverse logical names (cr175_...)
      const payload = {
        cr175_lch_title: b.title ?? b.cr175_lch_title ?? "",
        cr175_lch_url: b.url ?? b.cr175_lch_url ?? "",
        cr175_lch_icon: b.icon ?? b.cr175_lch_icon ?? "",
        cr175_lch_category: b.category ?? b.cr175_lch_category ?? "",
        cr175_lch_group: b.group ?? b.cr175_lch_group ?? "",
        cr175_lch_parent: b.parent ?? b.cr175_lch_parent ?? null,
        cr175_lch_allowedroles: b.allowedRoles ?? b.cr175_lch_allowedroles ?? "",
        cr175_lch_enabled: (b.enabled ?? b.cr175_lch_enabled) !== false,
        cr175_lch_sortorder: Number(b.sort ?? b.cr175_lch_sortorder ?? 1000),
        cr175_lch_openmode: b.openMode ?? b.cr175_lch_openmode ?? "newTab"
      };

      // Mange dvFetch wrappers returnerer den oprettede record direkte
      const created = await dvFetch(`${TABLE}`, { method: "POST", body: payload });

      // Hvis din dvFetch IKKE returnerer recorden, så fallback til re-query:
      if (created && created[IDCOL]) {
        return json(context, 200, mapOut(created));
      }

      const select = [IDCOL, "cr175_lch_title", "cr175_lch_url", "cr175_lch_icon", "cr175_lch_category", "cr175_lch_group", "cr175_lch_parent", "cr175_lch_allowedroles", "cr175_lch_enabled", "cr175_lch_sortorder", "cr175_lch_openmode"].join(",");
      const data = await dvFetch(`${TABLE}?$top=1&$orderby=createdon desc&$select=${select}`);
      return json(context, 200, mapOut((data.value || [])[0]));
    }

    if (m === "PUT" || m === "PATCH") {
      const b = req.body || {};
      if (!b.id) return json(context, 400, { error: "missing_id" });

      const payload = {
        cr175_lch_title: b.title ?? b.cr175_lch_title ?? "",
        cr175_lch_url: b.url ?? b.cr175_lch_url ?? "",
        cr175_lch_icon: b.icon ?? b.cr175_lch_icon ?? "",
        cr175_lch_category: b.category ?? b.cr175_lch_category ?? "",
        cr175_lch_group: b.group ?? b.cr175_lch_group ?? "",
        cr175_lch_parent: b.parent ?? b.cr175_lch_parent ?? null,
        cr175_lch_allowedroles: b.allowedRoles ?? b.cr175_lch_allowedroles ?? "",
        cr175_lch_enabled: (b.enabled ?? b.cr175_lch_enabled) !== false,
        cr175_lch_sortorder: Number(b.sort ?? b.cr175_lch_sortorder ?? 1000),
        cr175_lch_openmode: b.openMode ?? b.cr175_lch_openmode ?? "newTab"
      };

      await dvFetch(`${TABLE}(${b.id})`, { method: "PATCH", body: payload });
      return json(context, 200, { ok: true });
    }

    if (m === "DELETE") {
      const id = req.query?.id;
      if (!id) return json(context, 400, { error: "missing_id" });

      await dvFetch(`${TABLE}(${id})`, { method: "DELETE" });
      return json(context, 200, { ok: true });
    }

    return json(context, 405, { error: "method_not_allowed" });
  } catch (e) {
    return json(context, e.status || 500, {
      error: "server_error",
      message: e.message,
      data: e.data
    });
  }
};
