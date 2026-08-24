const { app } = require("@azure/functions");
const { graphFetch } = require("../lib/graphAuth");
const { checkAccess } = require("../lib/roleCheck");

app.http("listFiles", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "listfiles",
    handler: async (request, context) => {
        const access = await checkAccess(request);
        if (!access.isStatus) {
            return { status: 403, jsonBody: { error: "Ingen adgang" } };
        }

        const siteId = process.env.SPO_SiteId;
        const folderPath = process.env.SPO_FolderPath || "Optaellinger";

        try {
            const result = await graphFetch(
                `/sites/${siteId}/drive/root:/${encodeURIComponent(folderPath)}:/children?$select=id,name,lastModifiedDateTime,size`
            );

            const files = (result.value || [])
                .filter((f) => f.name.toLowerCase().endsWith(".xlsx"))
                .map((f) => ({
                    id: f.id,
                    name: f.name.replace(/\.xlsx$/i, ""),
                    lastModified: f.lastModifiedDateTime
                }))
                .sort((a, b) => (a.lastModified < b.lastModified ? 1 : -1));

            return { status: 200, jsonBody: { files } };
        } catch (err) {
            context.error(err);
            return { status: 500, jsonBody: { error: "Kunne ikke hente filliste: " + err.message } };
        }
    }
});
