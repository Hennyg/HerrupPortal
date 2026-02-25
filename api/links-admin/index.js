module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: { ok: true, path: req?.originalUrl || req?.url || "/api/links-admin" }
  };
};
