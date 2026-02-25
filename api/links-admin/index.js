// /api/links-admin/index.js
const { dvFetch } = require("../_dv");

const TABLE = "cr175_lch_portallinks";          // EntitySetName
const IDCOL = "cr175_lch_portallinkid";         // Primary key

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body
  };
}

function norm(s) {
  return String(s ?? "").trim();
}
function isGuid(s) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(s || ""));
}

// DV -> frontend
function mapOut(r) {
  return {
    id: r?.[IDCOL],

    title: r?.cr175_lch_title || "",
    url: r?.cr175_lch_url || "",
    icon: r?.cr175_lch_icon || "",

    // Tekstfelter (portal)
    category: r?.cr175_lch_categorytext || "",
    group: r?.cr175_lch_grouptext || "",

    // lookup: Dataverse returnerer _<lookup>_value
    parent: r?._cr175_lch_parent_value || null,

    allowedRoles: r?.cr175_lch_allowedroles || "",
    enabled: r?.cr175_lch_enabled !== false,
    sort: r?.cr175_lch_sortorder ?? 1000,

    // Tekstfelt (portal) - OBS: lille m i logical name
    openMode: r?.cr175_lch_openmodetext || "newTab"
  };
}

// frontend -> DV payload
function mapIn(b) {
  const category = norm(b.category ?? b.cr175_lch_categorytext ?? "");
  const isFav = category.toLowerCase() === "favoritter";

  const group = isFav
    ? norm(b.group ?? b.cr175_lch_grouptext ?? "")
    : "";

  const payload = {
    cr175_lch_title: norm(b.title ?? b.cr175_lch_title ?? ""),
    cr175_lch_url: norm(b.url ?? b.cr175_lch_url ?? ""),
    cr175_lch_icon: norm(b.icon ?? b.cr175_lch_icon ?? ""),

    cr175_lch_categorytext: category,
    cr175_lch_grouptext: group,

    // NY: openMode som tekst (lille m)
    cr175_lch_openmodetext: norm(b.openMode ?? b.cr175_lch_openmodetext ?? "newTab"),

    cr175_lch_allowedroles: norm(b.allowedRoles ?? b.cr175_lch_allowedroles ?? ""),
    cr175_lch_enabled: (b.enabled ?? b.cr175_lch_enabled) !== false,
    cr175_lch_sortorder: Number.isFinite(Number(b.sort ?? b.cr175_lch_sortorder))
      ? Number(b.sort ?? b.cr175_lch_sortorder)
      : 1000
  };

  // parent (lookup)
  const parentId = b.parent ?? b.cr175_lch_parent ?? null;
  if (parentId === null || parentId === "" || parentId === undefined) {
    // Nulstil relation (tilladt ved PATCH)
    payload["cr175_lch_parent@odata.bind"] = null;
  } else if (isGuid(parentId)) {
    payload["cr175_lch_parent@odata.bind"] = `/${TABLE}(${parentId})`;
  }

  return payload;
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

        // tekstfelter (portal)
        "cr175_lch_categorytext",
        "cr175_lch_grouptext",
        "cr175_lch_openmodetext",

        // lookup value
        "_cr175_lch_parent_value",

        "cr175_lch_allowedroles",
        "cr175_lch_enabled",
        "cr175_lch_sortorder"
      ].join(",");

      const data = await dvFetch(`${TABLE}?$select=${select}&$orderby=cr175_lch_sortorder asc`);
      return json(context, 200, (data.value || []).map(mapOut));
    }

    if (m === "POST") {
      const b = req.body || {};
      const payload = mapIn(b);

      const created = await dvFetch(`${TABLE}`, { method: "POST", body: payload });

      // hvis dvFetch returnerer objektet direkte
      if (created && created[IDCOL]) return json(context, 200, mapOut(created));

      // fallback: hent nyeste
      const select = [
        IDCOL,
        "cr175_lch_title","cr175_lch_url","cr175_lch_icon",
        "cr175_lch_categorytext","cr175_lch_grouptext","cr175_lch_openmodetext",
        "_cr175_lch_parent_value",
        "cr175_lch_allowedroles","cr175_lch_enabled","cr175_lch_sortorder"
      ].join(",");

      const data = await dvFetch(`${TABLE}?$top=1&$orderby=createdon desc&$select=${select}`);
      return json(context, 200, mapOut((data.value || [])[0]));
    }

    if (m === "PUT" || m === "PATCH") {
      const b = req.body || {};
      if (!b.id) return json(context, 400, { error: "missing_id" });

      const payload = mapIn(b);
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
      status: e.status,
      data: e.data,
      stack: e.stack
    });
  }
};
