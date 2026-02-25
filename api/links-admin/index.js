const { dvFetch } = require("../_dv");

module.exports = async function (context, req) {
  try {
    const data = await dvFetch(`WhoAmI`);
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { ok: true, whoami: data }
    };
  } catch (e) {
    context.res = {
      status: e.status || 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: {
        ok: false,
        where: "dvFetch(WhoAmI)",
        message: e.message,
        status: e.status,
        data: e.data,
        stack: e.stack
      }
    };
  }
};
