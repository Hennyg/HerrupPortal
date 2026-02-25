const { dvFetch } = require("../_dv");

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

module.exports = async function (context, req) {
  try {
    const q = `EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName&$filter=contains(LogicalName,'portallink')`;
    const data = await dvFetch(q);
    return json(context, 200, data);
  } catch (e) {
    return json(context, e.status || 500, { ok:false, message: e.message, status: e.status, data: e.data, stack: e.stack });
  }
};
