// api/entra-users/index.js
const fetch = globalThis.fetch;

const GROUP_NAME = "Alle - lely center herrup";

const USER_FIELDS = [
  "id", "displayName", "mail", "userPrincipalName",
  "jobTitle", "department", "mobilePhone", "businessPhones", "officeLocation", "accountEnabled"
].join(",");

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

// ── Token ─────────────────────────────────────────────────────────────────────
async function getGraphToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;

  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Manglende miljøvariabler: DV_TENANT_ID, DV_CLIENT_ID eller DV_CLIENT_SECRET");
  }

  const r = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default"
      })
    }
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`token_error ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

// ── Graph-fetch med paginering ────────────────────────────────────────────────
async function graphGetAll(token, url, extraHeaders = {}) {
  const items = [];
  let next = url;
  let firstCall = true;

  while (next) {
    const headers = { Authorization: `Bearer ${token}` };
    if (firstCall) Object.assign(headers, extraHeaders);
    firstCall = false;

    const r = await fetch(next, { headers });
    const j = await r.json();
    if (!r.ok) throw new Error(`graph_error ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
    items.push(...(j.value || []));
    next = j["@odata.nextLink"] || null;
  }

  return items;
}

// ── Find gruppe på displayName ────────────────────────────────────────────────
async function findGroupId(token, name) {
  const filter = encodeURIComponent(`displayName eq '${name}'`);
  const url = `https://graph.microsoft.com/v1.0/groups?$filter=${filter}&$select=id,displayName&$count=true`;
  const groups = await graphGetAll(token, url, { ConsistencyLevel: "eventual" });
  if (groups.length === 0) throw new Error(`Gruppe ikke fundet: "${name}"`);
  return groups[0].id;
}

// ── Hent alle brugere rekursivt via transitiveMembers ────────────────────────
async function getGroupMembers(token, groupId) {
  const url = `https://graph.microsoft.com/v1.0/groups/${groupId}/transitiveMembers/microsoft.graph.user?$select=${USER_FIELDS}&$top=100`;
  return graphGetAll(token, url);
}

// ── Hent foto som base64 (returnerer null hvis ingen) ────────────────────────
// 240x240, så billedet også er skarpt nok når det skal bruges i print
// (org-oversigten kan udskrives, hvor billedet skaleres op til flere cm).
// Selve Graph-kaldet tager ikke længere tid ved en større størrelse — kun
// payloaden bliver en anelse større.
async function getPhoto(token, userId) {
  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/photos/240x240/$value`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const ct  = r.headers.get("content-type") || "image/jpeg";
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

// ── Hent manager (returnerer { id, displayName } eller null) ─────────────────
async function getManager(token, userId) {
  try {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/manager?$select=id,displayName`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    return { id: j.id, displayName: j.displayName };
  } catch {
    return null;
  }
}

// ── Kør i batches for at undgå for mange parallelle kald ─────────────────────
async function runBatched(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── Dataverse: hent brugerdefinerede billeder for alle medarbejdere i ét kald ─
async function getDataverseToken() {
  const tenant       = process.env.DV_TENANT_ID;
  const clientId     = process.env.DV_CLIENT_ID;
  const clientSecret = process.env.DV_CLIENT_SECRET;
  const dvUrl        = process.env.DV_COREDATA;

  if (!tenant || !clientId || !clientSecret || !dvUrl) return null;

  try {
    const r = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "client_credentials",
          client_id:     clientId,
          client_secret: clientSecret,
          scope:         `${dvUrl}/.default`
        })
      }
    );
    const j = await r.json();
    if (!r.ok) return null;
    return j.access_token;
  } catch {
    return null;
  }
}

// Returnerer Map<mail-lowercase, dataUri> for alle medarbejdere der har uploadet
// et brugerdefineret billede. Fejler stille (tom Map) hvis Dataverse ikke kan nås —
// så herrup.html i så fald bare falder tilbage til Entra ID-billedet.
async function getCustomPhotoMap(context) {
  const map = new Map();
  const dvUrl = process.env.DV_COREDATA;
  if (!dvUrl) return map;

  try {
    const token = await getDataverseToken();
    if (!token) return map;

    let url = `${dvUrl}/api/data/v9.2/cr1eb_lch_medarbejderes?$select=cr1eb_lch_mail,cr1eb_lch_foto`;

    while (url) {
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "OData-MaxVersion": "4.0",
          "OData-Version": "4.0",
          Accept: "application/json"
        }
      });
      const j = await r.json();
      if (!r.ok) break;

      for (const row of (j.value || [])) {
        const mail = String(row.cr1eb_lch_mail || "").toLowerCase().trim();
        const foto = row.cr1eb_lch_foto;
        if (mail && foto) map.set(mail, foto);
      }

      url = j["@odata.nextLink"] || null;
    }
  } catch (e) {
    context.log("Kunne ikke hente brugerdefinerede billeder:", e.message);
  }

  return map;
}

// ── Kort-tids in-memory cache (pr. Function-instans) ─────────────────────────
// Bruges når frontend henter foto/manager i mindre bidder (via "ids"), så vi
// ikke slår gruppe-id og brugerdefinerede billeder op i Dataverse for hver
// eneste bid — kun første gang inden for et par sekunder.
const SHORT_CACHE_TTL_MS = 20 * 1000;
let groupIdCache = null; // { value, at }
let customPhotoCache = null; // { value: Map, at }

async function findGroupIdCached(token, name) {
  if (groupIdCache && (Date.now() - groupIdCache.at) < SHORT_CACHE_TTL_MS) {
    return groupIdCache.value;
  }
  const id = await findGroupId(token, name);
  groupIdCache = { value: id, at: Date.now() };
  return id;
}

async function getCustomPhotoMapCached(context) {
  if (customPhotoCache && (Date.now() - customPhotoCache.at) < SHORT_CACHE_TTL_MS) {
    return customPhotoCache.value;
  }
  const map = await getCustomPhotoMap(context);
  customPhotoCache = { value: map, at: Date.now() };
  return map;
}

// ── Handler ───────────────────────────────────────────────────────────────────
// Query-param "fast=1": returnér KUN gruppemedlemmerne med basale felter —
// uden foto og manager-opslag (som er de dyre, per-bruger Graph-kald).
// Bruges af frontend til at vise Entra ID-data med det samme, mens foto/
// manager hentes bagefter i baggrunden.
//
// Query-param "ids=<id1,id2,...>": berig KUN de angivne bruger-id'er (foto +
// manager) og returnér dem. Bruges af frontend til at hente billeder i mindre
// bidder, så de dukker løbende op på siden i stedet for alle på én gang.
module.exports = async function (context, req) {
  if (!req.headers["x-ms-client-principal"]) {
    return json(context, 401, { error: "Ikke logget ind" });
  }

  const fast    = String(req.query?.fast || "") === "1";
  const idsParam = String(req.query?.ids || "").trim();
  const idsFilter = idsParam
    ? new Set(idsParam.split(",").map(s => s.trim()).filter(Boolean))
    : null;

  try {
    const token   = await getGraphToken();
    const groupId = idsFilter
      ? await findGroupIdCached(token, GROUP_NAME)
      : await findGroupId(token, GROUP_NAME);
    let members = await getGroupMembers(token, groupId);

    if (idsFilter) {
      members = members.filter(u => idsFilter.has(u.id));
    }

    if (fast) {
      const basic = members
        .map(u => ({ ...u, photo: null, managerId: null, managerName: null, entraPhoto: null, hasCustomPhoto: false }))
        .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "da"));
      return json(context, 200, basic);
    }

    // Hent foto + manager for alle brugere i batches af 10
    const enriched = await runBatched(members, 10, async (user) => {
      const [photo, manager] = await Promise.all([
        getPhoto(token, user.id),
        getManager(token, user.id)
      ]);
      return { ...user, photo, managerId: manager?.id || null, managerName: manager?.displayName || null };
    });

    // Overskriv med brugerdefineret billede fra Dataverse, hvis medarbejderen har uploadet et.
    // entraPhoto gemmes altid uændret, så vi kan gå tilbage til den hvis brugerdefineret billede fjernes.
    const customPhotos = idsFilter
      ? await getCustomPhotoMapCached(context)
      : await getCustomPhotoMap(context);
    for (const user of enriched) {
      const mail = String(user.mail || user.userPrincipalName || "").toLowerCase().trim();
      const custom = mail ? customPhotos.get(mail) : null;
      user.entraPhoto = user.photo;
      user.hasCustomPhoto = !!custom;
      if (custom) user.photo = custom;
    }

    enriched.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "da"));
    return json(context, 200, enriched);
  } catch (e) {
    context.log("entra-users ERROR:", e.message);
    return json(context, 500, { error: e.message });
  }
};
