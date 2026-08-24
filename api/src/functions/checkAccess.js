const { app } = require("@azure/functions");
const { checkAccess } = require("../lib/roleCheck");

app.http("checkAccess", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "checkaccess",
    handler: async (request, context) => {
        const access = await checkAccess(request);
        return { status: 200, jsonBody: access };
    }
});
