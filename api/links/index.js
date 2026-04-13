const { dvFetch } = require("../_dv");

const TABLE = "cr175_lch_portallinks";
const IDCOL = "cr175_lch_portallinkid";

module.exports = async function (context, req) {
  try {
    const data = await dvFetch(
      `${TABLE}?$select=${IDCOL},cr175_lch_title,cr175_lch_url,cr175_lch_icon,` +
      `cr175_lch_categorytext,cr175_lch_grouptext,cr175_lch_allowedroles,` +
      `cr175_lch_enabled,cr175_lch_sortorder,cr175_lch_openmodetext` +
      `&$filter=cr175_lch_enabled eq true`
    );

    const out = (data.value || []).map(r => ({
      id:           r[IDCOL],
      title:        r.cr175_lch_title        || "",
      url:          r.cr175_lch_url          || "",
      icon:         r.cr175_lch_icon         || "",
      category:     r.cr175_lch_categorytext || "",
      group:        r.cr175_lch_grouptext    || "",
      parent:       r._cr175_lch_parent_value || null,
      allowedRoles: r.cr175_lch_allowedroles || "",
      enabled:      r.cr175_lch_enabled !== false,
      sort:         r.cr175_lch_sortorder ?? 1000,
      openMode:     r.cr175_lch_openmodetext || "newTab"
    }));

    context.res = { status: 200, body: out };
  } catch (e) {
    context.res = { status: e.status || 500, body: { error: e.message, data: e.data } };
  }
};
