// assets/entraCache.js
// Delt browser-cache (IndexedDB) for den berigede medarbejderliste fra
// /api/entra-users. Bruges af index.html (opvarmning + lokal søgning) og
// herrup.html (undgå at vente på et nyt hent hvis data stadig er friske).
//
// Cachen er pr. browser, men DELT mellem index.html og herrup.html, fordi
// de kører på samme origin (Static Web App).

const ENTRA_CACHE_DB     = "herrupPortal";
const ENTRA_CACHE_STORE  = "entraCache";
const ENTRA_CACHE_KEY    = "users";
const ENTRA_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutter

function entraDbOpen() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB ikke tilgængelig"));
      return;
    }
    const req = indexedDB.open(ENTRA_CACHE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(ENTRA_CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function entraCacheRead() {
  try {
    const db = await entraDbOpen();
    return await new Promise((resolve, reject) => {
      const tx  = db.transaction(ENTRA_CACHE_STORE, "readonly");
      const req = tx.objectStore(ENTRA_CACHE_STORE).get(ENTRA_CACHE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch {
    return null; // Privat-tilstand, blokeret IndexedDB osv. — falder bare tilbage til netværk.
  }
}

async function entraCacheWrite(data) {
  try {
    const db = await entraDbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ENTRA_CACHE_STORE, "readwrite");
      tx.objectStore(ENTRA_CACHE_STORE).put({ data, fetchedAt: Date.now() }, ENTRA_CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch {
    // Cache-skrivning må aldrig vælte resten af siden.
  }
}

function entraCacheIsFresh(entry) {
  return !!entry && Array.isArray(entry.data) && (Date.now() - entry.fetchedAt) < ENTRA_CACHE_TTL_MS;
}

// Henter fuld liste fra serveren og gemmer i browser-cachen.
async function entraCacheFetchFresh() {
  const r = await fetch("/api/entra-users", { cache: "no-store" });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${r.status}`);
  }
  const data = await r.json();
  entraCacheWrite(data); // fire-and-forget
  return data;
}

// Kaldes fra index.html ved load: varmer cachen op i baggrunden hvis den er
// tom/forældet. Kaster aldrig en fejl videre — det er "best effort".
async function entraCacheWarm() {
  try {
    const entry = await entraCacheRead();
    if (entraCacheIsFresh(entry)) return;
    await entraCacheFetchFresh();
  } catch {
    // Ignoreres — den side der reelt har brug for data, henter selv.
  }
}

// Hovedfunktion: returner friske data fra cache hvis muligt, ellers hent fra
// serveren og opdater cachen bagefter.
async function entraCacheGetUsers() {
  const entry = await entraCacheRead();
  if (entraCacheIsFresh(entry)) return entry.data;
  return entraCacheFetchFresh();
}

window.entraCacheGetUsers = entraCacheGetUsers;
window.entraCacheWarm     = entraCacheWarm;
window.entraCacheRead     = entraCacheRead;
window.entraCacheIsFresh  = entraCacheIsFresh;
