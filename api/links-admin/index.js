const { dvFetch } = require("../_dv");

module.exports = async function (context, req) {
  try {
    const logical = "cr175_lch_portallink";

    // Key lookup i stedet for $filter
    const data = await dvFetch(
      `EntityDefinitions(LogicalName='${logical}')?$select=LogicalName,EntitySetName,SchemaName`
    );

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { ok: true, data }
    };
  } catch (e) {
    context.res = {
      status: e.status || 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { ok: false, message: e.message, status: e.status, data: e.data, stack: e.stack }
    };
  }
};
