const { dvFetch } = require("../_dv");

const TABLE = "cr175_lch_portallinks";
const IDCOL = "cr175_lch_portallinkid";

module.exports = async function (context, req) {
  try {
    const data = await dvFetch(
      `${TABLE}?$select=${IDCOL},cr175_lch_title,cr175_lch_url,cr175_lch_icon,cr175_lch_categorytext,cr175_lch_grouptext,cr175_lch_allowedroles,cr175_lch_enabled,cr175_lch_sortorder,cr175_lch_openmodetext&$filter=cr175_lch_enabled eq true`
    );

    // samme mapning som før, men direkte
    const out = (data.value || []).map(r => ({
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
    }));

    context.res = { status: 200, body: out };
  } catch (e) {
    context.res = { status: e.status || 500, body: { error: e.message, data: e.data } };
  }
};
