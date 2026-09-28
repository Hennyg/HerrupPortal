// api/uniconta-debtors/index.js

const {
  unicontaFetch,
  normalizeDebtor
} = require("../_uniconta");

function json(context, status, body) {
  context.res = {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body
  };
}

module.exports = async function (context, req) {
  try {
    const requestedTop = Number.parseInt(
      req.query.top || "5000",
      10
    );

    const maxRows = Math.min(
      Math.max(
        Number.isFinite(requestedTop)
          ? requestedTop
          : 5000,
        1
      ),
      5000
    );

    const rows = [];

    // Uniconta OData understøtter startswith,
    // men ikke contains.
    const filter = `startswith(Account,'8000')`;

    let nextUrl =
      `DebtorClient` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$orderby=Name asc` +
      `&$top=${Math.min(maxRows, 1000)}`;

    while (nextUrl && rows.length < maxRows) {
      const response = await unicontaFetch(nextUrl);
      const data = await response.json();

      const page = Array.isArray(data)
        ? data
        : (data.value || []);

      rows.push(...page);

      nextUrl =
        data["@odata.nextLink"] ||
        data["odata.nextLink"] ||
        null;
    }

    const debtors = rows
      .map(normalizeDebtor)

      // Ekstra sikkerhed på debitornummer
      .filter(debtor =>
        String(debtor.account || "").startsWith("8000")
      )

      // Fjern alle hvor navnet indeholder "(udg)"
      .filter(debtor =>
        !String(debtor.name || "")
          .toLowerCase()
          .includes("(udg)")
      )

      .slice(0, maxRows)
      .map(({ raw, ...item }) => item);

    return json(context, 200, {
      debtors,
      count: debtors.length,
      truncated: rows.length >= maxRows
    });
  } catch (error) {
    context.log.error(
      "uniconta-debtors failed",
      error
    );

    return json(context, 502, {
      error: "uniconta_error",
      message: error.message
    });
  }
};



