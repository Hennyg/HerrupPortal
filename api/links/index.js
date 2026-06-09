const { dvFetch } = require("../_dv");

const TABLE = "cr175_lch_portallinks";
const IDCOL = "cr175_lch_portallinkid";
const SUBGROUP_COL = "cr175_lch_subgroup";

// Forklaring-feltet er normalt prefikset med publisher-prefix i Dataverse.
// Hvis dit logical name faktisk er lch_forklaring, håndterer fallback det også.
const DESCRIPTION_COLS = ["cr175_lch_forklaring", "lch_forklaring"];

function mapRow(r, { hasSubgroup, descriptionCol }) {
  return {
    id:           r[IDCOL],
    title:        r.cr175_lch_title        || "",
    url:          r.cr175_lch_url          || "",
    icon:         r.cr175_lch_icon         || "",
    description:  descriptionCol ? (r[descriptionCol] || "") : "",
    forklaring:   descriptionCol ? (r[descriptionCol] || "") : "",
    category:     r.cr175_lch_categorytext || "",
    group:        r.cr175_lch_grouptext    || "",
    subgroup:     hasSubgroup ? (r[SUBGROUP_COL] || "") : "",
    parent:       r._cr175_lch_parent_value || null,
    allowedRoles: r.cr175_lch_allowedroles || "",
    enabled:      r.cr175_lch_enabled !== false,
    sort:         r.cr175_lch_sortorder ?? 1000,
    openMode:     r.cr175_lch_openmodetext || "newTab"
  };
}

async function getLinks() {
  const baseCols = [
    IDCOL,
    "cr175_lch_title",
    "cr175_lch_url",
    "cr175_lch_icon",
    "cr175_lch_categorytext",
    "cr175_lch_grouptext",
    "cr175_lch_allowedroles",
    "cr175_lch_enabled",
    "cr175_lch_sortorder",
    "cr175_lch_openmodetext"
  ];

  const variants = [];
  for (const descriptionCol of DESCRIPTION_COLS) {
    variants.push({ hasSubgroup: true, descriptionCol, cols: [...baseCols, SUBGROUP_COL, descriptionCol] });
    variants.push({ hasSubgroup: false, descriptionCol, cols: [...baseCols, descriptionCol] });
  }
  variants.push({ hasSubgroup: true, descriptionCol: null, cols: [...baseCols, SUBGROUP_COL] });
  variants.push({ hasSubgroup: false, descriptionCol: null, cols: baseCols });

  let lastError;
  for (const v of variants) {
    try {
      const select = v.cols.join(",");
      const data = await dvFetch(`${TABLE}?$select=${select}&$filter=cr175_lch_enabled eq true`);
      return { ...v, rows: data.value || [] };
    } catch (e) {
      lastError = e;
      if ((e?.status || 0) !== 400) throw e;
    }
  }
  throw lastError;
}

module.exports = async function (context, req) {
  try {
    const { hasSubgroup, descriptionCol, rows } = await getLinks();
    const out = rows.map(r => mapRow(r, { hasSubgroup, descriptionCol }));
    context.res = { status: 200, body: out };
  } catch (e) {
    context.res = { status: e.status || 500, body: { error: e.message, data: e.data } };
  }
};
