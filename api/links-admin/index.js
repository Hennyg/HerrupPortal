const crypto = require("crypto");

let links = [];

module.exports = async function (context, req) {
  const method = (req.method || "GET").toUpperCase();

  // CORS-ish / preflight
  if (method === "OPTIONS") {
    context.res = { status: 204, headers: { "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" } };
    return;
  }

  if (method === "GET") {
    context.res = { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: links };
    return;
  }

  if (method === "POST") {
    const item = req.body || {};
    item.id = crypto.randomUUID();
    links.push(item);
    context.res = { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: item };
    return;
  }

  if (method === "PUT") {
    const item = req.body || {};
    if (!item.id) {
      context.res = { status: 400, body: { error: "missing_id" } };
      return;
    }
    const i = links.findIndex(x => x.id === item.id);
    if (i === -1) links.push(item);
    else links[i] = item;

    context.res = { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: item };
    return;
  }

  if (method === "DELETE") {
    const id = req.query?.id;
    links = links.filter(x => x.id !== id);
    context.res = { status: 200, body: { ok: true } };
    return;
  }

  context.res = { status: 405, body: { error: "method_not_allowed" } };
};
