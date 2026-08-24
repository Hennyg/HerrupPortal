// roleCheck.js
// Adgangstjek mod App Roles på selve app-registreringen — samme mønster som i HerrupPortal
// (api/employee-private/index.js): portal_status / portal_admin er App Roles defineret på
// AZURE_CLIENT_ID's App Registration, og brugere/grupper tildeles dem under Enterprise
// Applications -> Users and groups.
//
// Roller læses IKKE fra principal.claims (den er tom i Azure Functions-backend'en), men slås
// i stedet op direkte via Graph (appRoleAssignments) mod service principal'en for
// AZURE_CLIENT_ID, med samme app-only Graph-token som resten af API'et bruger.

const { graphFetch } = require("./graphAuth");

function getPrincipal(request) {
    const header = request.headers.get("x-ms-client-principal");
    if (!header) return null;
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded); // { identityProvider, userId, userDetails, userRoles, claims }
}

// Slår login-app'ens (AZURE_CLIENT_ID) service principal op, inkl. dens App Roles.
// Bruges til at kunne oversætte et appRoleId til det læsbare rollenavn (fx "portal_status").
async function getAppServicePrincipal() {
    const clientId = process.env.AZURE_CLIENT_ID;
    if (!clientId) throw new Error("Mangler AZURE_CLIENT_ID i Application Settings");

    const result = await graphFetch(
        `/servicePrincipals?$filter=appId eq '${clientId}'&$select=id,appId,appRoles`
    );
    const sp = (result.value || [])[0];
    if (!sp) throw new Error("Service principal ikke fundet for AZURE_CLIENT_ID");
    return sp;
}

// Henter de portal_xxx-roller den indloggede bruger reelt har, via Graph (appRoleAssignments),
// i stedet for principal.claims.
async function getUserPortalRoles(userId) {
    if (!userId) return [];
    try {
        const sp = await getAppServicePrincipal();
        const result = await graphFetch(`/users/${userId}/appRoleAssignments`);

        const roleIdToValue = new Map((sp.appRoles || []).map((r) => [r.id, String(r.value || "")]));

        return (result.value || [])
            .filter((a) => a.resourceId === sp.id)
            .map((a) => (roleIdToValue.get(a.appRoleId) || "").toLowerCase())
            .filter(Boolean);
    } catch (err) {
        // Fejler Graph-opslaget (rettigheder, netværk osv.), skal brugeren IKKE
        // automatisk regnes som admin.
        return [];
    }
}

async function checkAccess(request) {
    const principal = getPrincipal(request);
    if (!principal) {
        return { authenticated: false, isAdmin: false, isStatus: false, user: null };
    }

    const roles = await getUserPortalRoles(principal.userId);
    const isAdmin = roles.includes("portal_admin");
    const isStatus = isAdmin || roles.includes("portal_status"); // admin har altid også status-adgang

    return {
        authenticated: true,
        isAdmin,
        isStatus,
        user: {
            objectId: principal.userId,
            name: principal.userDetails
        }
    };
}

module.exports = { checkAccess };
