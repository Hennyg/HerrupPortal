module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: { ok: true, fn: "getroles" }
  };
};
