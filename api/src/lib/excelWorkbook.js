// excelWorkbook.js
// Hjælpefunktioner til at læse/skrive Excel-tabeller i en given fil via Microsoft Graph
// workbook-API'et. "fileId" er drive-item-id'et for den Excel-fil brugeren har valgt i
// filvælgeren (se listFiles.js).

const { graphFetch } = require("./graphAuth");

function siteId() {
    const id = process.env.SPO_SiteId;
    if (!id) throw new Error("Mangler SPO_SiteId i Application Settings");
    return id;
}

function itemBase(fileId) {
    return `/sites/${siteId()}/drive/items/${fileId}/workbook`;
}

/** Henter alle rækker (som rå værdi-arrays) + headerrække for en given tabel i filen. */
async function getTableRows(fileId, tableName) {
    const [headerResult, rowsResult] = await Promise.all([
        graphFetch(`${itemBase(fileId)}/tables/${encodeURIComponent(tableName)}/headerRowRange`),
        graphFetch(`${itemBase(fileId)}/tables/${encodeURIComponent(tableName)}/rows`)
    ]);

    const headerValues = headerResult.values[0]; // fx ["Varenummer","Varenavn",...]
    const rows = rowsResult.value.map((r, index) => ({
        index,
        values: r.values[0]
    }));

    return { headerValues, rows };
}

/**
 * Opdaterer en specifik række (fundet på rækkeindeks) med nye værdier.
 * newValuesByIndex: array i samme rækkefølge som header, med `null` for felter der ikke skal ændres
 * skal IKKE bruges direkte – brug patchRowByColumnValues i stedet for at undgå at overskrive
 * andre kolonner ved en fejl i rækkefølgen.
 */
async function patchRowValues(fileId, tableName, rowIndex, fullRowValues) {
    return graphFetch(`${itemBase(fileId)}/tables/${encodeURIComponent(tableName)}/rows/${rowIndex}`, {
        method: "PATCH",
        body: JSON.stringify({ values: [fullRowValues] })
    });
}

/** Finder rækkeindeks ud fra en kolonneværdi (fx Varenummer), case-insensitivt + trimmet. */
function findRowIndex(rows, columnIndex, columnName, matchValue) {
    const colIdx = columnIndex[columnName];
    if (colIdx === undefined) return -1;

    const target = String(matchValue).trim().toLowerCase();
    return rows.findIndex((r) => String(r.values[colIdx] ?? "").trim().toLowerCase() === target);
}

/** Tilføjer en ny række til en tabel. values skal matche tabellens kolonnerækkefølge. */
async function addTableRow(fileId, tableName, values) {
    return graphFetch(`${itemBase(fileId)}/tables/${encodeURIComponent(tableName)}/rows/add`, {
        method: "POST",
        body: JSON.stringify({ values: [values] })
    });
}

module.exports = { getTableRows, patchRowValues, findRowIndex, addTableRow };
