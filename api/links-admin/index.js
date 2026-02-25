module.exports = async function (context, req) {
  try {
    const mod = require("../_dv"); // <- kun load
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { ok: true, dvLoaded: !!mod, keys: Object.keys(mod || {}) }
    };
  } catch (e) {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: { ok: false, where: "require(_dv)", message: e.message, stack: e.stack }
    };
  }
};
