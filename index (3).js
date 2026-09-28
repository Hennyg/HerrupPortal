const { unicontaFetch, normalizeDebtor } = require("../_uniconta");

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}
function esc(value) { return String(value || "").replace(/'/g, "''"); }

module.exports = async function (context, req) {
  try {
    const account = String(req.params.account || "").trim();
    if (!account) return json(context, 400, { message: "Mangler debitornummer." });

    const response = await unicontaFetch(`DebtorClient?$filter=Account eq '${esc(account)}'&$top=1`);
    const data = await response.json();
    const row = (Array.isArray(data) ? data : (data.value || []))[0];
    if (!row) return json(context, 404, { message: "Debitoren blev ikke fundet." });

    return json(context, 200, { debtor: normalizeDebtor(row) });
  } catch (error) {
    context.log.error("uniconta-debtor failed", error);
    return json(context, 502, { error: "uniconta_error", message: error.message });
  }
};



