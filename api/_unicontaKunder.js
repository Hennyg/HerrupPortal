// api/_unicontaKunder.js
// Debitorer fra Uniconta (kontonumre 8000…) i en let udgave til kundelisten:
//   { kundenr: "0080002026", konto: "80002026", navn, distrikt }
// Kundenr. fyldes op til 10 cifre, så det kan sammenlignes med kundelisten.
// Listen caches i 15 min, så kun den første, der åbner kundelisten, venter.
//
// Distrikt-feltet: Uniconta kalder det normalt "District". Hedder det noget
// andet hos jer, sættes app setting UNICONTA_DISTRICT_FIELD (fx "Dim1").
// Feltnavnene kan ses på /api/uniconta/test?entity=DebtorClient

const { unicontaFetch } = require("./_uniconta");

const CACHE_MS = 15 * 60 * 1000;
let cache = { at: 0, list: null, byNr: null, loading: null };

const pad10 = v => { const s = String(v ?? "").trim(); return /^\d+$/.test(s) && s.length < 10 ? s.padStart(10, "0") : s; };

function distriktFelter() {
  const f = String(process.env.UNICONTA_DISTRICT_FIELD || "").trim();
  return [...(f ? [f] : []), "District", "DistrictName", "Distrikt"];
}
function first(row, names) {
  for (const n of names) {
    const v = row?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

async function hent() {
  const rows = [];
  const filter = encodeURIComponent("startswith(Account,'8000')");
  let next = `DebtorClient?$filter=${filter}&$orderby=Name asc&$top=1000`;
  for (let guard = 0; next && guard < 20; guard++) {
    const r = await unicontaFetch(next);
    const data = await r.json();
    rows.push(...(Array.isArray(data) ? data : (data.value || [])));
    next = data["@odata.nextLink"] || data["odata.nextLink"] || null;
  }
  const df = distriktFelter();
  const list = rows
    .map(r => ({
      konto: first(r, ["Account", "account"]),
      navn: first(r, ["Name", "name"]),
      distrikt: first(r, df)
    }))
    .filter(d => d.konto.startsWith("8000") && !d.navn.toLowerCase().includes("(udg)"))
    .map(d => ({ ...d, kundenr: pad10(d.konto) }));
  return list;
}

// Hele listen (fra cache, hvis den er frisk). Kun én hentning ad gangen.
async function unicontaKunder() {
  if (cache.list && Date.now() - cache.at < CACHE_MS) return cache.list;
  if (!cache.loading) {
    cache.loading = hent()
      .then(list => { cache = { at: Date.now(), list, byNr: new Map(list.map(d => [d.kundenr, d])), loading: null }; return list; })
      .catch(e => { cache.loading = null; throw e; });
  }
  return cache.loading;
}

async function unicontaKunde(kundenr) {
  await unicontaKunder();
  return cache.byNr?.get(pad10(kundenr)) || null;
}

module.exports = { unicontaKunder, unicontaKunde, pad10 };
