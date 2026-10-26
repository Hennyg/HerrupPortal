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

const ORDER_NO_FIELDS = ["OrderNumber", "OrderNo", "OrderNum", "Order"];
const lineOrderNo = row => String(firstValue(row, ORDER_NO_FIELDS) ?? "");

async function query(path) {
  const r = await unicontaFetch(path);
  const data = await r.json();
  return {
    rows: Array.isArray(data) ? data : (data.value || []),
    next: data["@odata.nextLink"] || data["odata.nextLink"] || null
  };
}

async function tryQuery(path, context) {
  try { return await query(path); }
  catch (e) { context.log.warn("uniconta-salgsordrer:", path, e.message); return null; }
}

// Henter linjerne for én ordre. Uniconta ignorerer i nogle tilfælde $filter på
// ordrelinjer og returnerer alle linjer, så resultatet kontrolleres altid på
// ordrenummeret i hver linje. Virker filteret ikke, gennemløbes linjerne
// side for side og frasorteres her.
async function getOrderLines(order, context) {
  const attempts = [
    `OrderNumber eq ${order}`,
    `OrderNumber eq '${order}'`
  ];
  for (const f of attempts) {
    const res = await tryQuery(`${LINE_ENTITY}?$filter=${encodeURIComponent(f)}&$top=1000`, context);
    if (!res) continue;
    if (!res.rows.length) return { rows: [], method: "filter" };
    if (res.rows.every(r => lineOrderNo(r) === order)) return { rows: res.rows, method: "filter" };
    if (!res.rows.some(r => lineOrderNo(r))) {
      throw new Error("Ordrelinjerne har ikke et ordrenummer-felt. Felter på en linje: " + Object.keys(res.rows[0]).join(", "));
    }
  }

  // Filteret blev ignoreret – gennemløb alle linjer og frasortér.
  const pageSize = 1000;
  const maxRows = parseInt(process.env.UNICONTA_ORDERLINE_SCAN_MAX || "100000", 10);
  const found = [];
  let scanned = 0;
  let next = `${LINE_ENTITY}?$top=${pageSize}`;
  while (next && scanned < maxRows) {
    const page = await query(next);
    scanned += page.rows.length;
    for (const r of page.rows) if (lineOrderNo(r) === order) found.push(r);
    if (page.next) next = page.next;
    else if (page.rows.length === pageSize) next = `${LINE_ENTITY}?$top=${pageSize}&$skip=${scanned}`;
    else next = null;
  }
  return { rows: found, method: "scan" };
}

module.exports = async function (context, req) {
  const user = await A.requireUniconta(context, req, "salgsordre");
  if (!user) return;

  try {
    const order = String(req.query.order || "").trim();

    if (order) {
      if (!/^\d{1,12}$/.test(order)) return A.json(context, 400, { error: "Ugyldigt ordrenummer" });
      const head = await query(`${ORDER_ENTITY}?$filter=${encodeURIComponent(`OrderNumber eq ${order}`)}&$top=50`);
      const headRow = head.rows.find(r => String(firstValue(r, ORDER_NO_FIELDS) ?? "") === order);
      if (!headRow) return A.json(context, 404, { error: `Ordre ${order} blev ikke fundet` });

      const { rows, method } = await getOrderLines(order, context);
      const mapped = rows.map(normalizeLine)
        .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
      return A.json(context, 200, { order: normalizeOrder(headRow), lines: mapped, lineMethod: method });
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
