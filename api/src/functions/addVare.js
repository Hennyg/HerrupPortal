const { app } = require("@azure/functions");
const { checkAccess } = require("../lib/roleCheck");
const { addTableRow, getTableRows } = require("../lib/excelWorkbook");
const { TABEL2_NAVN, TABEL2_KOLONNER, buildColumnIndex } = require("../lib/varerMapping");

app.http("addVare", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "addvare/{fileId}",
    handler: async (request, context) => {
        const access = await checkAccess(request);
        if (!access.isStatus) {
            return { status: 403, jsonBody: { error: "Ingen adgang" } };
        }

        const fileId = request.params.fileId;
        const body = await request.json();
        const { varenummer, farve, antal, notat } = body;

        if (!fileId || !varenummer) {
            return { status: 400, jsonBody: { error: "Mangler fileId eller varenummer" } };
        }

        const farveNorm = String(farve || "").trim().toLowerCase();

        try {
            // Header bestemmer kolonnerækkefølgen i den fil brugeren har valgt
            const { headerValues } = await getTableRows(fileId, TABEL2_NAVN);
            const columnIndex = buildColumnIndex(headerValues);

            const rowValues = new Array(headerValues.length).fill(null);
            rowValues[columnIndex[TABEL2_KOLONNER.varenummer]] = varenummer;
            if (columnIndex[TABEL2_KOLONNER.notat] !== undefined) {
                rowValues[columnIndex[TABEL2_KOLONNER.notat]] = notat || "";
            }

            if (farveNorm === "gul" && columnIndex[TABEL2_KOLONNER.optaltGul] !== undefined) {
                rowValues[columnIndex[TABEL2_KOLONNER.optaltGul]] = antal ?? 0;
            } else if (farveNorm === "gron" && columnIndex[TABEL2_KOLONNER.optaltGron] !== undefined) {
                rowValues[columnIndex[TABEL2_KOLONNER.optaltGron]] = antal ?? 0;
            }

            await addTableRow(fileId, TABEL2_NAVN, rowValues);

            return { status: 200, jsonBody: { ok: true } };
        } catch (err) {
            context.error(err);
            return { status: 500, jsonBody: { error: "Kunne ikke oprette linje i Tabel2: " + err.message } };
        }
    }
});
