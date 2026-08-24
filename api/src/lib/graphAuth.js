// graphAuth.js
// Fælles hjælper til at hente et app-only Graph-token (client credentials flow).
// Følger samme mønster som _coredata.js i dine andre apps.

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getGraphToken() {
    const now = Date.now();
    if (cachedToken && now < cachedTokenExpiry - 30000) {
        return cachedToken;
    }

    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
        throw new Error(
            "Mangler AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET i Application Settings"
        );
    }

    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
    });

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Kunne ikke hente Graph-token: ${res.status} ${errText}`);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    cachedTokenExpiry = now + data.expires_in * 1000;
    return cachedToken;
}

async function graphFetch(path, options = {}) {
    const token = await getGraphToken();
    const url = path.startsWith("https://") ? path : `https://graph.microsoft.com/v1.0${path}`;

    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Graph-kald fejlede (${res.status}) for ${path}: ${errText}`);
    }

    // Nogle Graph-kald (fx DELETE) returnerer ikke indhold
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

module.exports = { getGraphToken, graphFetch };
