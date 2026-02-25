const { dvFetch } = require("../_dv");

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}
function esc(s){ return String(s ?? "").replace(/'/g,"''"); }

module.exports = async function (context, req) {
  try {
    const logical = "cr175_lch_portallink";
    const q = `EntityDefinitions?$select=LogicalName,EntitySetName&$filter=LogicalName eq '${esc(logical)}'`;
    const data = await dvFetch(q);
    return json(context, 200, data);
  } catch (e) {
    return json(context, e.status || 500, { message: e.message, status: e.status, data: e.data, stack: e.stack });
  }
};
