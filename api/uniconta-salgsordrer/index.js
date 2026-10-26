// /api/uniconta-salgsordrer/index.js
// GET /api/uniconta/salgsordrer            → de nyeste salgsordrer (?top=, maks 5000)
// GET /api/uniconta/salgsordrer?order=123  → én ordre med ordrelinjer
const A = require("../_unicontaAccess");
const { unicontaFetch } = require("../_uniconta");

const ORDER_ENTITY = process.env.UNICONTA_ORDER_ENTITY || "DebtorOrderClient";
const LINE_ENTITY = process.env.UNICONTA_ORDERLINE_ENTITY || "DebtorOrderLineClient";

function firstValue(row, names) {
  for (const n of names) {
    const v = row?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}
const str = (row, names) => String(firstValue(row, names) ?? "");
function num(row, names) {
  const n = Number(firstValue(row, names));
  return Number.isFinite(n) ? n : null;
}

function normalizeOrder(row) {
  return {
    orderNumber: str(row, ["OrderNumber", "OrderNo"]),
    account: str(row, ["Account", "DebtorAccount"]),
    name: str(row, ["Name", "DebtorName", "AccountName"]),
    created: str(row, ["Created", "Date", "OrderDate"]),
    deliveryDate: str(row, ["DeliveryDate", "RequestedDeliveryDate"]),
    yourRef: str(row, ["YourRef"]),
    ourRef: str(row, ["OurRef"]),
    employee: str(row, ["Employee", "EmployeeName"]),
    remark: str(row, ["Remark", "Text", "Note"]),
    currency: str(row, ["Currency", "CurrencyCode"]),
    total: num(row, ["OrderTotal", "Total", "TotalAmount", "SalesValue"]),
    deliveryName: str(row, ["DeliveryName"]),
    deliveryAddress: [str(row, ["DeliveryAddress1"]), str(row, ["DeliveryZipCode"]), str(row, ["DeliveryCity"])].filter(Boolean).join(", "),
    raw: row
  };
}

function normalizeLine(row) {
  return {
    lineNumber: num(row, ["LineNumber", "LineNo"]),
    item: str(row, ["Item", "ItemNumber"]),
    text: str(row, ["Text", "Name", "ItemName", "Description"]),
    qty: num(row, ["Qty", "Quantity"]),
    qtyDelivered: num(row, ["QtyDelivered", "Delivered", "QtyInvoiced"]),
    unit: str(row, ["Unit", "UnitText"]),
    price: num(row, ["Price", "SalesPrice", "UnitPrice"]),
    discountPct: num(row, ["DiscountPct", "DiscountPercent"]),
    total: num(row, ["Total", "Amount", "LineTotal"]),
    warehouse: str(row, ["Warehouse"]),
    raw: row
  };
}

async function query(path) {
  const r = await unicontaFetch(path);
  const data = await r.json();
  return {
    rows: Array.isArray(data) ? data : (data.value || []),
    next: data["@odata.nextLink"] || data["odata.nextLink"] || null
  };
}

module.exports = async function (context, req) {
  const user = await A.requireUniconta(context, req, "salgsordre");
  if (!user) return;

  try {
    const order = String(req.query.order || "").trim();

    if (order) {
      if (!/^\d{1,12}$/.test(order)) return A.json(context, 400, { error: "Ugyldigt ordrenummer" });
      const [head, lines] = await Promise.all([
        query(`${ORDER_ENTITY}?$filter=${encodeURIComponent(`OrderNumber eq ${order}`)}&$top=1`),
        query(`${LINE_ENTITY}?$filter=${encodeURIComponent(`OrderNumber eq ${order}`)}`)
      ]);
      if (!head.rows.length) return A.json(context, 404, { error: `Ordre ${order} blev ikke fundet` });
      const mapped = lines.rows.map(normalizeLine)
        .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
      return A.json(context, 200, { order: normalizeOrder(head.rows[0]), lines: mapped });
    }

    const requested = parseInt(req.query.top || "2000", 10);
    const maxRows = Math.min(Math.max(Number.isFinite(requested) ? requested : 2000, 1), 5000);
    // Sider på 1000. Bruger nextLink hvis Uniconta sender et, ellers $skip.
    const pageSize = Math.min(maxRows, 1000);
    const rows = [];
    let next = `${ORDER_ENTITY}?$orderby=OrderNumber desc&$top=${pageSize}`;
    while (next && rows.length < maxRows) {
      const page = await query(next);
      rows.push(...page.rows);
      if (page.next) next = page.next;
      else if (page.rows.length === pageSize) next = `${ORDER_ENTITY}?$orderby=OrderNumber desc&$top=${pageSize}&$skip=${rows.length}`;
      else next = null;
    }

    const orders = rows.slice(0, maxRows).map(normalizeOrder).map(({ raw, ...o }) => o);
    return A.json(context, 200, { orders, count: orders.length, truncated: rows.length >= maxRows });
  } catch (e) {
    context.log.error("uniconta-salgsordrer:", e);
    return A.json(context, 502, { error: "Uniconta-fejl: " + e.message });
  }
};
