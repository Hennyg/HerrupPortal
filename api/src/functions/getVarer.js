const { app } = require("@azure/functions");
const { checkAccess } = require("../lib/roleCheck");
const { getTableRows } = require("../lib/excelWorkbook");
const { TABEL1_NAVN, TABEL1_KOLONNER, buildColumnIndex, rowToObject } = require("../lib/varerMapping");

app.http("getVarer", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "getvarer/{fileId}",
    handler: async (request, context) => {
        const access = await checkAccess(request);
        if (!access.isStatus) {
            return { status: 403, jsonBody: { error: "Ingen adgang" } };
        }

        const fileId = request.params.fileId;
        if (!fileId) {
            return { status: 400, jsonBody: { error: "Mangler fileId" } };
        }

        try {
            const { headerValues, rows } = await getTableRows(fileId, TABEL1_NAVN);
            const columnIndex = buildColumnIndex(headerValues);

            const varer = rows.map((r) => rowToObject(r.values, columnIndex, TABEL1_KOLONNER));

            return { status: 200, jsonBody: { varer } };
        } catch (err) {
            context.error(err);
            return { status: 500, jsonBody: { error: "Kunne ikke hente varer: " + err.message } };
        }
    }
});
