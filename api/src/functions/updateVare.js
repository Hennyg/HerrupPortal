const { app } = require("@azure/functions");
const { checkAccess } = require("../lib/roleCheck");
const { getTableRows, patchRowValues, findRowIndex } = require("../lib/excelWorkbook");
const { TABEL1_NAVN, TABEL1_KOLONNER, buildColumnIndex } = require("../lib/varerMapping");

app.http("updateVare", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "updatevare/{fileId}",
    handler: async (request, context) => {
        const access = await checkAccess(request);
        if (!access.isStatus) {
            return { status: 403, jsonBody: { error: "Ingen adgang" } };
        }

        const fileId = request.params.fileId;
        const body = await request.json();
        const { varenummer, farve, antal, notat } = body;

        if (!fileId || !varenummer || !farve) {
            return { status: 400, jsonBody: { error: "Mangler fileId, varenummer eller farve" } };
        }

        const farveNorm = String(farve).trim().toLowerCase();
        if (farveNorm !== "gul" && farveNorm !== "gron") {
            return { status: 400, jsonBody: { error: "farve skal være 'gul' eller 'gron'" } };
        }

        try {
            const { headerValues, rows } = await getTableRows(fileId, TABEL1_NAVN);
            const columnIndex = buildColumnIndex(headerValues);

            const rowIndex = findRowIndex(rows, columnIndex, TABEL1_KOLONNER.varenummer, varenummer);
            if (rowIndex === -1) {
                return { status: 404, jsonBody: { error: "Varenummer ikke fundet i Tabel1" } };
            }

            const currentValues = [...rows[rowIndex].values];

            const optaltKolonne = farveNorm === "gul" ? TABEL1_KOLONNER.optaltGul : TABEL1_KOLONNER.optaltGron;
            currentValues[columnIndex[optaltKolonne]] = antal ?? 0;

            if (notat !== undefined) {
                const notatIdx = columnIndex[TABEL1_KOLONNER.notat];
                if (notatIdx !== undefined) currentValues[notatIdx] = notat;
            }

            await patchRowValues(fileId, TABEL1_NAVN, rowIndex, currentValues);

            return { status: 200, jsonBody: { ok: true } };
        } catch (err) {
            context.error(err);
            return { status: 500, jsonBody: { error: "Kunne ikke opdatere vare: " + err.message } };
        }
    }
});
