// /api/sms-migrate/index.js
// Flytter "SMS service log" (SharePoint-liste) over i Dataverse-tabellen
// cr175_lch_sms_service. Kun for admin.
//
//   GET  /api/sms-migrate          → tjek: antal i listen, allerede flyttet, mangler
//   POST /api/sms-migrate {limit}  → flytter op til `limit` rækker (standard 150)
//
// Kan køres igen og igen: rækker der allerede er flyttet (samme SharePoint-ID
// i kolonnen cr175_lch_spid) springes over. Siden kalder POST gentagne gange,
// indtil "remaining" er 0.
const fetch = globalThis.fetch;
const S = require("../_sms");
const C = S.COL;

// Listen ligger på Henriks OneDrive-site (fundet i PowerApps-appen).
const SP_SITE = process.env.SMS_SP_SITE || "lcherrup-my.sharepoint.com:/personal/hng_lcherrup_dk";
const SP_LIST = process.env.SMS_SP_LIST_ID || "007abf46-6d42-4317-94af-d021e42d6d3e";
const TIME_BUDGET_MS = 30000; // stop i god tid før Azure Functions' timeout

async function graphToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DV_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.DV_CLIENT_ID,
      client_secret: process.env.DV_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default"
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Graph token-fejl ${r.status}: ${j.error_description || JSON.stringify(j)}`);
  return j.access_token;
}

async function graphGet(token, url) {
  const r = await fetch(url.startsWith("http") ? url : `https://graph.microsoft.com/v1.0/${url}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Graph ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

async function readSharePointItems() {
  const token = await graphToken();
  let site;
  try {
    site = await graphGet(token, `sites/${SP_SITE}`);
  } catch (e) {
    if (e.status === 403 || e.status === 401) {
      throw new Error(`Ingen adgang til SharePoint-sitet (${SP_SITE}). App-registreringen skal have Graph-rettigheden Sites.Read.All (application) med admin consent. ${e.message}`);
    }
    throw e;
  }
  const items = [];
  let url = `sites/${site.id}/lists/${SP_LIST}/items?$expand=fields&$top=500`;
  while (url) {
    const j = await graphGet(token, url);
    items.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  return items;
}

async function migratedIds() {
  const rows = await S.dvGetAll(`${S.TABLE}?$select=${C.spId}&$filter=${C.spId} ne null`);
  return new Set(rows.map(r => Number(r[C.spId])).filter(Number.isFinite));
}

function mapItem(it) {
  const f = it.fields || {};
  const modtagere = String(f.Modtagere || "").replace(/\r\n/g, "\n").trim();
  const antalModtagere = modtagere ? modtagere.split(/\n+/).filter(x => x.trim()).length : 0;
  const created = f.Created || it.createdDateTime || null;
  const test = f.Test === true || String(f.Test).toLowerCase() === "true";
  const antal = Number(f.AntalSMS);
  return {
    [C.titel]: created ? S.formatTitle(created) : String(f.Title || "SMS").slice(0, 100),
    [C.modtagere]: modtagere,
    [C.besked]: String(f.Besked || ""),
    [C.afsender]: String(f.Afsender || it.createdBy?.user?.displayName || ""),
    [C.afsenderMail]: String(it.createdBy?.user?.email || ""),
    [C.test]: test,
    [C.antalSms]: Number.isFinite(antal) ? Math.round(antal) : null,
    [C.antalModtagere]: antalModtagere,
    [C.sendt]: created,
    [C.status]: test ? "Test (migreret)" : "Sendt (migreret)",
    [C.spId]: Number(it.id)
  };
}

module.exports = async function (context, req) {
  const user = S.requireAccess(context, req, { admin: true });
  if (!user) return;

  const started = Date.now();
  try {
    const [items, done] = await Promise.all([readSharePointItems(), migratedIds()]);
    const todo = items
      .filter(it => !done.has(Number(it.id)))
      .sort((a, b) => Number(a.id) - Number(b.id));

    if ((req.method || "GET").toUpperCase() === "GET") {
      return S.json(context, 200, {
        total: items.length,
        alreadyMigrated: items.length - todo.length,
        remaining: todo.length,
        sample: todo.slice(0, 3).map(mapItem)
      });
    }

    const limit = Math.min(Math.max(parseInt(req.body?.limit, 10) || 150, 1), 500);
    let migrated = 0;
    const failed = [];
    for (const it of todo.slice(0, limit)) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      try {
        await S.dvFetch(S.TABLE, { method: "POST", body: mapItem(it) });
        migrated++;
      } catch (e) {
        failed.push({ spId: Number(it.id), error: e.message });
      }
    }

    return S.json(context, 200, {
      total: items.length,
      migrated,
      failed,
      remaining: todo.length - migrated - failed.length,
      // Fejlede rækker forsøges igen ved næste kørsel.
      retryable: failed.length
    });
  } catch (e) {
    context.log.error("sms-migrate:", e);
    return S.json(context, 500, { error: e.message });
  }
};
