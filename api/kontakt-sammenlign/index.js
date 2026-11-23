// api/kontakt-sammenlign/index.js
// Sammenligner Outlook-kontakter i kildepostkassen (kontakter@lcherrup.dk) med
// kontakterne i en brugers standard-kontaktmappe (der hvor CiraSync/synk lægger dem).
// Kun portal_admin.
//
//   GET ?action=me            → { admin }
//   GET ?user=<objectId|mail> → { kilde, bruger, mangler, kunBruger, forskelle, ens }
//
// Kræver Graph-applikationstilladelsen Contacts.Read på portalens app-registrering.
// Kildepostkassen kan ændres med app setting KONTAKTER_MAILBOX.

const N = require("../_news");

const KILDE = () => String(process.env.KONTAKTER_MAILBOX || "kontakter@lcherrup.dk").trim();
const SELECT = "displayName,givenName,surname,companyName,jobTitle,emailAddresses,businessPhones,mobilePhone,homePhones,businessAddress,homeAddress";
const MAX_LIST = 1000;

async function isAdmin(me) {
  let roles = me.roles || [];
  try { roles = await N.lookupRoles(me); } catch { /* brug rollerne fra login */ }
  return roles.map(r => String(r).toLowerCase()).includes("portal_admin");
}

async function hentKontakter(token, mailbox) {
  const out = [];
  let url = `users/${encodeURIComponent(mailbox)}/contacts?$select=${SELECT}&$top=999`;
  for (let guard = 0; url && guard < 50; guard++) {
    const j = await N.graphJson(token, url);
    out.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  return out;
}

// ── Normalisering ───────────────────────────────────────────────────────────
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
// Telefon: kun cifre, dansk +45/0045 fjernes, så "+45 12 34 56 78" = "12345678"
function tlf(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.startsWith("0045")) d = d.slice(4);
  else if (d.length === 10 && d.startsWith("45")) d = d.slice(2);
  return d;
}
const adr = a => a ? [a.street, a.postalCode, a.city].map(norm).filter(Boolean).join(", ") : "";

// De felter, der sammenlignes (vist navn → værdi som tekst)
function felter(c) {
  const mails = [...new Set((c.emailAddresses || []).map(e => norm(e.address)).filter(Boolean))].sort();
  const tlfs = [...new Set([...(c.businessPhones || []), c.mobilePhone, ...(c.homePhones || [])].map(tlf).filter(Boolean))].sort();
  return {
    "Firma": norm(c.companyName),
    "Stilling": norm(c.jobTitle),
    "E-mail": mails.join(", "),
    "Telefon": tlfs.join(", "),
    "Arbejdsadresse": adr(c.businessAddress),
    "Privatadresse": adr(c.homeAddress)
  };
}

// Visning: originale værdier (ikke normaliseret)
function vis(c) {
  return {
    navn: c.displayName || [c.givenName, c.surname].filter(Boolean).join(" ") || "(uden navn)",
    firma: c.companyName || "",
    mail: (c.emailAddresses || []).map(e => e.address).filter(Boolean).join(", "),
    tlf: [...(c.businessPhones || []), c.mobilePhone, ...(c.homePhones || [])].filter(Boolean).join(", ")
  };
}

// Nøgle = vist navn (normaliseret). Dubletter med samme navn holdes som lister.
function indeks(list) {
  const m = new Map();
  for (const c of list) {
    const k = norm(c.displayName || [c.givenName, c.surname].filter(Boolean).join(" "));
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  return m;
}

function sammenlign(kilde, bruger) {
  const ki = indeks(kilde), bi = indeks(bruger);
  const mangler = [], kunBruger = [], forskelle = [];
  let ens = 0;

  for (const [k, kList] of ki) {
    const bList = bi.get(k);
    if (!bList) { kList.forEach(c => mangler.push(vis(c))); continue; }
    // Samme navn: sammenlign første med første (dubletter nævnes)
    const a = felter(kList[0]), b = felter(bList[0]);
    const diff = Object.keys(a).filter(f => a[f] !== b[f])
      .map(f => ({ felt: f, kilde: a[f], bruger: b[f] }));
    if (diff.length) forskelle.push({ ...vis(kList[0]), diff });
    else ens++;
    if (kList.length !== bList.length) {
      forskelle.push({ ...vis(kList[0]), diff: [{ felt: "Antal med samme navn", kilde: String(kList.length), bruger: String(bList.length) }] });
    }
  }
  for (const [k, bList] of bi) if (!ki.has(k)) bList.forEach(c => kunBruger.push(vis(c)));

  const sort = (x, y) => x.navn.localeCompare(y.navn, "da");
  return {
    mangler: mangler.sort(sort).slice(0, MAX_LIST),
    kunBruger: kunBruger.sort(sort).slice(0, MAX_LIST),
    forskelle: forskelle.sort(sort).slice(0, MAX_LIST),
    ens,
    antal: { mangler: mangler.length, kunBruger: kunBruger.length, forskelle: forskelle.length }
  };
}

module.exports = async function (context, req) {
  const me = N.getPrincipal(req);
  if (!me) return N.json(context, 401, { error: "Ikke logget ind" });

  try {
    const admin = await isAdmin(me);
    if (String(req.query.action || "") === "me") return N.json(context, 200, { admin });
    if (!admin) return N.json(context, 403, { error: "Kræver rollen portal_admin" });

    const user = String(req.query.user || "").trim();
    if (!user) return N.json(context, 400, { error: "user mangler" });

    const token = await N.graphToken();
    const t0 = Date.now();
    const [kilde, bruger] = await Promise.all([hentKontakter(token, KILDE()), hentKontakter(token, user)]);
    const res = sammenlign(kilde, bruger);

    return N.json(context, 200, {
      kildeMailbox: KILDE(),
      kilde: kilde.length,
      bruger: bruger.length,
      ms: Date.now() - t0,
      ...res
    });
  } catch (e) {
    context.log("kontakt-sammenlign ERROR:", e.message);
    const hint = /403|Access is denied|Authorization_RequestDenied|ErrorAccessDenied/i.test(e.message)
      ? " – mangler appen Graph-tilladelsen Contacts.Read (applikation)?" : "";
    return N.json(context, 500, { error: e.message + hint });
  }
};
