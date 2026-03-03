// /api/links-admin/index.js
const { dvFetch } = require("../_dv");

const TABLE = "cr175_lch_portallinks";
const IDCOL = "cr175_lch_portallinkid";

// Platform tekstfelt
const PLATFORM_COL = "cr175_lch_platformhinttext";

// Undergruppe tekstfelt (ret hvis dit felt hedder noget andet)
const SUBGROUP_COL = "cr175_lch_subgrouptext";

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body
  };
}

function norm(s) { return String(s ?? "").trim(); }
function isGuid(s) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(s || ""));
}

function normPlatformHint(v) {
  const x = norm(v).toLowerCase();
  if (!x) return "All";
  if (x === "all") return "All";
  if (x === "desktop" || x === "pc") return "Desktop";
  if (x === "mobile" || x === "telefon" || x === "phone") return "Mobile";
  return "All";
}

// DV -> frontend
function mapOut(r, { hasSubgroup } = { hasSubgroup: true }) {
  return {
    id: r?.[IDCOL],

    title: r?.cr175_lch_title || "",
    url: r?.cr175_lch_url || "",
    icon: r?.cr175_lch_icon || "",

    category: r?.cr175_lch_categorytext || "",
    group: r?.cr175_lch_grouptext || "",

    // NYT: kun hvis feltet findes i select
    subgroup: hasSubgroup ? (r?.[SUBGROUP_COL] || "") : "",

    parent: r?._cr175_lch_parent_value || null,

    allowedRoles: r?.cr175_lch_allowedroles || "",
    enabled: r?.cr175_lch_enabled !== false,
    sort: r?.cr175_lch_sortorder ?? 1000,

    openMode: r?.cr175_lch_openmodetext || "newTab",

    platformHint: r?.[PLATFORM_COL] || "All"
  };
}

// frontend -> DV payload
function mapIn(b, { hasSubgroup } = { hasSubgroup: true }) {
  const category = norm(b.category ?? b.cr175_lch_categorytext ?? "");
  const isFav = category.toLowerCase() === "favoritter";
  const group = isFav ? norm(b.group ?? b.cr175_lch_grouptext ?? "") : "";
  const subgroup = isFav ? norm(b.subgroup ?? b.subGroup ?? b[SUBGROUP_COL] ?? "") : "";

  const payload = {
    cr175_lch_title: norm(b.title ?? b.cr175_lch_title ?? ""),
    cr175_lch_url: norm(b.url ?? b.cr175_lch_url ?? ""),
    cr175_lch_icon: norm(b.icon ?? b.cr175_lch_icon ?? ""),

    cr175_lch_categorytext: category,
    cr175_lch_grouptext: group,

    cr175_lch_openmodetext: norm(b.openMode ?? b.cr175_lch_openmodetext ?? "newTab"),
    [PLATFORM_COL]: normPlatformHint(b.platformHint ?? b.platformhint ?? b[PLATFORM_COL]),

    cr175_lch_allowedroles: norm(b.allowedRoles ?? b.cr175_lch_allowedroles ?? ""),
    cr175_lch_enabled: (b.enabled ?? b.cr175_lch_enabled) !== false,
    cr175_lch_sortorder: Number.isFinite(Number(b.sort ?? b.cr175_lch_sortorder))
      ? Number(b.sort ?? b.cr175_lch_sortorder)
      : 1000
  };

  // Undergruppe kun hvis feltet findes (og vi vælger at bruge det)
  if (hasSubgroup) payload[SUBGROUP_COL] = subgroup;

  // parent (lookup)
  const parentId = b.parent ?? b.cr175_lch_parent ?? null;
  if (parentId === null || parentId === "" || parentId === undefined) {
    payload["cr175_lch_parent@odata.bind"] = null;
  } else if (isGuid(parentId)) {
    payload["cr175_lch_parent@odata.bind"] = `/${TABLE}(${parentId})`;
  }

  return payload;
}

// Helper: prøv GET med subgroup i select, og fallback uden hvis DV siger 400
async function dvGetLinksWithFallback() {
  const baseCols = [
    IDCOL,
    "cr175_lch_title",
    "cr175_lch_url",
    "cr175_lch_icon",
    "cr175_lch_categorytext",
    "cr175_lch_grouptext",
    "cr175_lch_openmodetext",
    PLATFORM_COL,
    "_cr175_lch_parent_value",
    "cr175_lch_allowedroles",
    "cr175_lch_enabled",
    "cr175_lch_sortorder"
  ];

  // 1) prøv med subgroup
  try {
    const select = [...baseCols, SUBGROUP_COL].join(",");
    const data = await dvFetch(`${TABLE}?$select=${select}&$orderby=cr175_lch_sortorder asc`);
    return { hasSubgroup: true, rows: (data.value || []) };
  } catch (e) {
    // 2) hvis det var 400 (ofte ukendt kolonne), prøv uden subgroup
    if ((e?.status || 0) === 400) {
      const select = baseCols.join(",");
      const data = await dvFetch(`${TABLE}?$select=${select}&$orderby=cr175_lch_sortorder asc`);
      return { hasSubgroup: false, rows: (data.value || []) };
    }
    throw e;
  }
}

module.exports = async function (context, req) {
  try {
    const m = (req.method || "GET").toUpperCase();

    if (m === "GET") {
      const { hasSubgroup, rows } = await dvGetLinksWithFallback();
      return json(context, 200, rows.map(r => mapOut(r, { hasSubgroup })));
    }

    // POST/PUT/PATCH: vi prøver at skrive med subgroup – hvis DV giver 400, skriver vi uden
    async function writeWithFallback(method, idOrNull) {
      const body = req.body || {};
      try {
        const payload = mapIn(body, { hasSubgroup: true });
        if (method === "POST") return await dvFetch(`${TABLE}`, { method: "POST", body: payload });
        await dvFetch(`${TABLE}(${idOrNull})`, { method: "PATCH", body: payload });
        return { ok: true };
      } catch (e) {
        if ((e?.status || 0) === 400) {
          const payload = mapIn(body, { hasSubgroup: false });
          if (method === "POST") return await dvFetch(`${TABLE}`, { method: "POST", body: payload });
          await dvFetch(`${TABLE}(${idOrNull})`, { method: "PATCH", body: payload });
          return { ok: true, subgroupIgnored: true };
        }
        throw e;
      }
    }

    if (m === "POST") {
      const created = await writeWithFallback("POST", null);
      // returnér noget brugbart
      if (created && created[IDCOL]) {
        // hent igen så vi får ens output
        const { hasSubgroup, rows } = await dvGetLinksWithFallback();
        const row = rows.find(r => r[IDCOL] === created[IDCOL]);
        return json(context, 200, mapOut(row || created, { hasSubgroup }));
      }
      return json(context, 200, { ok: true });
    }

    if (m === "PUT" || m === "PATCH") {
      const b = req.body || {};
      if (!b.id) return json(context, 400, { error: "missing_id" });
      const res = await writeWithFallback("PATCH", b.id);
      return json(context, 200, res);
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
