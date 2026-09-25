
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

// Henter KUN de basale Entra ID-felter (intet foto, ingen manager-opslag) —
// hurtigt svar, så siden kan vise navn/mail/titel/afdeling med det samme.
// Skrives ALDRIG til den delte cache, da dette ikke er de fulde data.
async function entraCacheFetchFast() {
  const r = await fetch("/api/entra-users?fast=1", { cache: "no-store" });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${r.status}`);
  }
  return r.json();
}

// Henter foto + manager for et afgrænset sæt bruger-id'er (én "bid" af
// listen). Bruges til at hente billeder løbende i stedet for alle på én
// gang — se entraCacheFetchEnrichedInChunks nedenfor.
async function entraCacheFetchEnrichmentChunk(ids) {
  const r = await fetch(`/api/entra-users?ids=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${r.status}`);
  }
  return r.json();
}

// Henter foto/manager for ALLE givne bruger-id'er i bidder af "chunkSize",
// og kalder onChunk(enrichedUsersForThatChunk) hver gang en bid er klar —
// så den kaldende side kan opdatere billederne løbende i stedet for at
// vente på at det hele er hentet.
async function entraCacheFetchEnrichedInChunks(ids, onChunk, chunkSize = 12) {
  const all = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunkIds = ids.slice(i, i + chunkSize);
    try {
      const chunkData = await entraCacheFetchEnrichmentChunk(chunkIds);
      all.push(...chunkData);
      if (typeof onChunk === "function") onChunk(chunkData);
    } catch {
      // En enkelt bid der fejler (fx forbigående netværksfejl) må ikke
      // stoppe resten — de øvrige bidder hentes stadig.
    }
  }
  return all;
}

// Varmer medarbejder-cachen op i baggrunden, hvis den er tom/forældet.
// Samme to-fasede hentning som herrup.html: først den hurtige liste
// (?fast=1), derefter foto + manager i små bidder. Det er lettere for
// serveren end ét samlet kald og rammer ikke Functions' timeout, når der
// kommer flere medarbejdere. Først når ALT er beriget, skrives listen til
// den delte cache — så herrup.html aldrig får en liste uden billeder.
// Kaster aldrig en fejl videre — det er "best effort".
let __entraWarmPromise = null;
async function entraCacheWarm() {
  if (__entraWarmPromise) return __entraWarmPromise; // kører allerede på denne side
  __entraWarmPromise = (async () => {
    try {
      const entry = await entraCacheRead();
      if (entraCacheIsFresh(entry)) return;

      const baseData = await entraCacheFetchFast();
      const byId = new Map(baseData.map(u => [u.id, u]));
      await entraCacheFetchEnrichedInChunks([...byId.keys()], (chunk) => {
        for (const e of chunk) {
          const u = byId.get(e.id);
          if (!u) continue;
          u.photo          = e.photo;
          u.managerId      = e.managerId;
          u.managerName    = e.managerName;
          u.entraPhoto     = e.entraPhoto;
          u.hasCustomPhoto = e.hasCustomPhoto;
        }
      });
      await entraCacheWrite(baseData);
    } catch {
      // Ignoreres — den side der reelt har brug for data, henter selv.
    } finally {
      __entraWarmPromise = null;
    }
  })();
  return __entraWarmPromise;
}

// Hovedfunktion: returner friske data fra cache hvis muligt, ellers hent fra
// serveren og opdater cachen bagefter.
async function entraCacheGetUsers() {
  const entry = await entraCacheRead();
  if (entraCacheIsFresh(entry)) return entry.data;
  return entraCacheFetchFresh();
}

window.entraCacheGetUsers               = entraCacheGetUsers;
window.entraCacheWarm                    = entraCacheWarm;
window.entraCacheRead                    = entraCacheRead;
window.entraCacheIsFresh                 = entraCacheIsFresh;
window.entraCacheFetchFast               = entraCacheFetchFast;
window.entraCacheFetchEnrichedInChunks   = entraCacheFetchEnrichedInChunks;
window.entraCacheWrite                   = entraCacheWrite;

// ── Generiske hjælpefunktioner ────────────────────────────────────────────────
// Bruges af andre datatyper end medarbejderlisten (fx vagt/ferie-planen i
// herrup-vagtferie.js), som vil genbruge samme IndexedDB-lager og TTL-mønster,
// men under deres egen nøgle.
const HERRUP_CACHE_DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutter

async function herrupCacheReadKey(key) {
  try {
    const db = await entraDbOpen();
    return await new Promise((resolve, reject) => {
      const tx  = db.transaction(ENTRA_CACHE_STORE, "readonly");
      const req = tx.objectStore(ENTRA_CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function herrupCacheWriteKey(key, data) {
  try {
    const db = await entraDbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ENTRA_CACHE_STORE, "readwrite");
      tx.objectStore(ENTRA_CACHE_STORE).put({ data, fetchedAt: Date.now() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch {
    // Cache-skrivning må aldrig vælte resten af siden.
  }
}

async function herrupCacheDeleteKey(key) {
  try {
    const db = await entraDbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ENTRA_CACHE_STORE, "readwrite");
      tx.objectStore(ENTRA_CACHE_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch {
    // Ignoreres — værste fald er at den gamle cache-post lever videre til TTL udløber.
  }
}

function herrupCacheEntryIsFresh(entry, ttlMs) {
  return !!entry && entry.data !== undefined && entry.data !== null &&
    (Date.now() - entry.fetchedAt) < (ttlMs ?? HERRUP_CACHE_DEFAULT_TTL_MS);
}

window.herrupCacheReadKey      = herrupCacheReadKey;
window.herrupCacheWriteKey     = herrupCacheWriteKey;
window.herrupCacheDeleteKey    = herrupCacheDeleteKey;
window.herrupCacheEntryIsFresh = herrupCacheEntryIsFresh;
window.VAGTFERIE_CACHE_TTL_MS  = HERRUP_CACHE_DEFAULT_TTL_MS;

// Sletter medarbejder-cachen, så næste hentning (fra index.html eller
// herrup.html) altid rammer serveren friskt, uanset TTL. Bruges af
// "Opdater data"-knappen i herrup.html, fx efter en rettelse i Entra ID
// eller i regnearket bag vagt/ferie-planen.
async function entraCacheInvalidate() {
  await herrupCacheDeleteKey(ENTRA_CACHE_KEY);
}
window.entraCacheInvalidate = entraCacheInvalidate;

// ── Vagt/ferie-planen i baggrunden ───────────────────────────────────────────
// Samme cache-nøgle og format som herrup-vagtferie.js (vagtferie:<år>), så
// "Dagens status" på personalelisten er klar med det samme.
let __vagtFerieWarmPromise = null;
async function vagtFerieCacheWarm() {
  if (__vagtFerieWarmPromise) return __vagtFerieWarmPromise;
  __vagtFerieWarmPromise = (async () => {
    try {
      const year = new Date().getFullYear();
      const key = `vagtferie:${year}`;
      const entry = await herrupCacheReadKey(key);
      if (herrupCacheEntryIsFresh(entry, HERRUP_CACHE_DEFAULT_TTL_MS)) return;

      const r = await fetch(`/api/vagtferieplan?year=${year}`, { cache: "no-store" });
      if (!r.ok) return;
      const text = await r.text();
      const data = text ? JSON.parse(text) : null;
      if (data) await herrupCacheWriteKey(key, data);
    } catch {
      // Ignoreres — personalelisten henter selv, hvis cachen er tom.
    } finally {
      __vagtFerieWarmPromise = null;
    }
  })();
  return __vagtFerieWarmPromise;
}
window.vagtFerieCacheWarm = vagtFerieCacheWarm;

// ── Opvarmning fra forsiden ──────────────────────────────────────────────────
// Venter til forsiden er tegnet og browseren er ledig, så links og nyheder
// ikke skal konkurrere med medarbejderdata. Derefter hentes vagt/ferie og
// medarbejderlisten parallelt i baggrunden.
function herrupBackgroundWarm(delayMs = 2000) {
  const start = () => {
    vagtFerieCacheWarm();
    entraCacheWarm();
  };
  const whenIdle = () => {
    if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 5000 });
    else start();
  };
  const schedule = () => setTimeout(whenIdle, delayMs);
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}
window.herrupBackgroundWarm = herrupBackgroundWarm;
