// /api/uniconta-varelager/index.js
// GET /api/uniconta/varelager?q=<varenr eller stregkode>
// Slår først op på varenummer (Item), dernæst på stregkode (EAN). Findes der
// ikke et præcist match, returneres op til 20 varer hvis varenummer starter med q.
const A = require("../_unicontaAccess");
const { unicontaFetch } = require("../_uniconta");

const ENTITY = process.env.UNICONTA_INVITEM_ENTITY || "InvItemClient";

function esc(v) { return String(v || "").replace(/'/g, "''"); }

function firstValue(row, names) {
  for (const n of names) {
    const v = row?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalize(row) {
  const qty = num(firstValue(row, ["Qty", "QtyOnStock", "OnStock"]));
  const reserved = num(firstValue(row, ["QtyReserved", "Reserved"]));
  let available = num(firstValue(row, ["Available", "QtyAvailable"]));
  if (available === null && qty !== null) available = qty - (reserved || 0);
  return {
    item: String(firstValue(row, ["Item", "ItemNumber"]) ?? ""),
    name: String(firstValue(row, ["Name", "ItemName", "Description"]) ?? ""),
    group: String(firstValue(row, ["Group", "ItemGroup"]) ?? ""),
    unit: String(firstValue(row, ["Unit", "UnitText"]) ?? ""),
    ean: String(firstValue(row, ["EAN", "Ean", "Barcode"]) ?? ""),
    warehouse: String(firstValue(row, ["Warehouse", "WarehouseName"]) ?? ""),
    location: String(firstValue(row, ["Location", "LocationName"]) ?? ""),
    qty,
    reserved,
    ordered: num(firstValue(row, ["QtyOrdered", "Ordered"])),
    available,
    salesPrice: num(firstValue(row, ["SalesPrice1", "SalesPrice", "Price"])),
    costPrice: num(firstValue(row, ["CostPrice", "CostValue"])),
    blocked: Boolean(firstValue(row, ["Blocked"])),
    raw: row
  };
}

async function query(path) {
  const r = await unicontaFetch(path);
  const data = await r.json();
  return Array.isArray(data) ? data : (data.value || []);
}

// En kolonne der ikke findes (fx EAN) giver fejl hos Uniconta – det behandles som "intet fundet".
async function tryQuery(path, context) {
  try { return await query(path); }
  catch (e) { context.log.warn("uniconta-varelager opslag fejlede:", path, e.message); return []; }
}

module.exports = async function (context, req) {
  const user = await A.requireUniconta(context, req, "varelager");
  if (!user) return;

  const q = String(req.query.q || "").trim().slice(0, 100);
  if (!q) return A.json(context, 400, { error: "Skriv et varenummer" });

  try {
    let rows = await query(`${ENTITY}?$filter=${encodeURIComponent(`Item eq '${esc(q)}'`)}&$top=5`);
    let matchedOn = "item";

    if (!rows.length) {
      rows = await tryQuery(`${ENTITY}?$filter=${encodeURIComponent(`EAN eq '${esc(q)}'`)}&$top=5`, context);
      matchedOn = "ean";
    }

    if (rows.length) {
      return A.json(context, 200, { q, matchedOn, items: rows.map(normalize) });
    }

    const similar = await tryQuery(
      `${ENTITY}?$filter=${encodeURIComponent(`startswith(Item,'${esc(q)}')`)}&$orderby=Item asc&$top=20`, context);
    return A.json(context, 200, {
      q,
      matchedOn: null,
      items: [],
      suggestions: similar.map(normalize).map(({ raw, ...x }) => x)
    });
  } catch (e) {
    context.log.error("uniconta-varelager:", e);
    return A.json(context, 502, { error: "Uniconta-fejl: " + e.message });
  }
};
