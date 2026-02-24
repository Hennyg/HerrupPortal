let links = [];

module.exports = async function (context, req) {
  const method = req.method.toUpperCase();

  if (method === "GET") {
    context.res = { status: 200, body: links };
    return;
  }

  if (method === "POST") {
    const item = req.body;
    item.id = crypto.randomUUID();
    links.push(item);
    context.res = { status: 200, body: item };
    return;
  }

  if (method === "PUT") {
    const item = req.body;
    const i = links.findIndex(x => x.id === item.id);
    if (i !== -1) links[i] = item;
    context.res = { status: 200, body: item };
    return;
  }

  if (method === "DELETE") {
    const id = req.query.id;
    links = links.filter(x => x.id !== id);
    context.res = { status: 200 };
    return;
  }

  context.res = { status: 405 };
};
