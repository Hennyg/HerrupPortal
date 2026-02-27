module.exports = async function (context, req) {
  const principal = req.headers["x-ms-client-principal"];

  if (!principal) {
    context.res = { status: 200, body: [] };
    return;
  }

  const decoded = JSON.parse(Buffer.from(principal, "base64").toString("utf8"));
  const roles = decoded.userRoles || [];

  context.res = {
    status: 200,
    body: roles
  };
};
