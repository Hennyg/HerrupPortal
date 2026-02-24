const { dvFetch } = require("../_dv");

const TABLE = "lch_portallinks";
const IDCOL = "lch_portallinkid";

module.exports = async function (context, req) {
  try {
    const data = await dvFetch(
      `${TABLE}?$select=${IDCOL},lch_title,lch_url,lch_icon,lch_category,lch_group,lch_parent,lch_allowedroles,lch_enabled,lch_sortorder,lch_openmode&$filter=lch_enabled eq true`
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
