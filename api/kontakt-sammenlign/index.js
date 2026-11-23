// api/kontakt-sammenlign/index.js
// Sammenligner Outlook-kontakter i kildepostkassen (kontakter@lcherrup.dk) med
// kontakterne i en brugers standard-kontaktmappe (der hvor CiraSync/synk lægger dem).
// Kun portal_admin.
//
//   GET ?action=me            → { admin }
//   GET ?user=<objectId|mail> → { kilde, bruger, fundet, mangler, dubletter, forskelle, antal }
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

// Kun retningen kontakter@ → bruger kontrolleres. Brugerens egne kontakter
// vises ikke, medmindre de er dubletter af en kontakt fra kontakter@.
//
// 1) Parring: kontakter med samme navn parres én-til-én, bedste match først
//    (samme mail/telefon). kontakter@ kan selv have flere kontakter med samme
//    navn (fx gårdnavn med flere personer) – de tælles hver for sig.
// 2) mangler:   kontakter@-kontakt uden makker hos brugeren
//    dubletter: brugeren har FLERE med navnet end kontakter@, eller brugeren har
//               en EGEN kontakt (ikke parret med noget fra kontakter@) med samme
//               telefon eller mail ("link")
//    forskelle: den parrede kopi afviger fra kontakter@
function nogler(c) {
  const f = felter(c);
  return {
    tlf: f["Telefon"] ? f["Telefon"].split(", ").filter(t => t.length >= 6) : [],
    mail: f["E-mail"] ? f["E-mail"].split(", ") : []
  };
}
const navnAf = c => norm(c.displayName || [c.givenName, c.surname].filter(Boolean).join(" "));

function score(k, b) {
  const fk = felter(k), fb = felter(b);
  if (Object.keys(fk).every(f => fk[f] === fb[f])) return 100;
  const nk = nogler(k), nb = nogler(b);
  let p = 0;
  if (nk.mail.some(m => nb.mail.includes(m))) p += 10;
  if (nk.tlf.some(t => nb.tlf.includes(t))) p += 10;
  if (fk["Firma"] && fk["Firma"] === fb["Firma"]) p += 2;
  return p;
}

function sammenlign(kilde, bruger) {
  const kGrp = indeks(kilde), bGrp = indeks(bruger);
  const makker = new Map();            // kontakter@-kontakt → brugerens kopi
  const parret = new Set();            // brugerens kontakter, der er en kopi
  const ekstraSammeNavn = new Map();   // navn → antal ekstra hos brugeren

  // 1) Parring pr. navn – bedste par først
  for (const [navn, kList] of kGrp) {
    const bList = (bGrp.get(navn) || []).slice();
    const par = [];
    for (const k of kList) for (const b of bList) par.push({ k, b, s: score(k, b) });
    par.sort((x, y) => y.s - x.s);
    for (const { k, b } of par) {
      if (makker.has(k) || parret.has(b)) continue;
      makker.set(k, b); parret.add(b);
    }
    if (bList.length > kList.length) ekstraSammeNavn.set(navn, bList.length - kList.length);
  }

  // Brugerens egne kontakter (ikke kopier) indekseret på telefon og mail
  const egne = bruger.filter(b => !parret.has(b));
  const byTlf = new Map(), byMail = new Map();
  for (const c of egne) {
    const n = nogler(c);
    n.tlf.forEach(t => { if (!byTlf.has(t)) byTlf.set(t, new Set()); byTlf.get(t).add(c); });
    n.mail.forEach(m => { if (!byMail.has(m)) byMail.set(m, new Set()); byMail.get(m).add(c); });
  }
  function linksFor(k) {
    const n = nogler(k), links = new Map();
    n.tlf.forEach(t => (byTlf.get(t) || []).forEach(c => links.set(c, `tlf. ${t}`)));
    n.mail.forEach(m => (byMail.get(m) || []).forEach(c => { if (!links.has(c)) links.set(c, m); }));
    // Kontakter med samme navn tælles under "flere med samme navn", ikke som links
    return [...links.entries()].filter(([c]) => navnAf(c) !== navnAf(k)).map(([c, via]) => ({ ...vis(c), via }));
  }

  const mangler = [], dubletter = [], forskelle = [];
  const ekstraVist = new Set();
  for (const k of kilde) {
    const navn = navnAf(k);
    if (!navn) continue;
    const links = linksFor(k);
    const b = makker.get(k);

    if (!b) { mangler.push({ ...vis(k), andetNavn: links }); continue; }

    // Ekstra med samme navn nævnes kun én gang pr. navn
    const ekstra = !ekstraVist.has(navn) ? (ekstraSammeNavn.get(navn) || 0) : 0;
    if (ekstra) ekstraVist.add(navn);
    if (ekstra || links.length) {
      dubletter.push({ ...vis(k), sammeNavn: ekstra ? (kGrp.get(navn).length + ekstra) : 1, iKilde: kGrp.get(navn).length, links });
    }

    const a = felter(k), c = felter(b);
    const diff = Object.keys(a).filter(f => a[f] !== c[f]).map(f => ({ felt: f, kilde: a[f], bruger: c[f] }));
    if (diff.length) forskelle.push({ ...vis(k), diff });
  }

  const sort = (x, y) => x.navn.localeCompare(y.navn, "da");
  return {
    fundet: makker.size,
    mangler: mangler.sort(sort).slice(0, MAX_LIST),
    dubletter: dubletter.sort(sort).slice(0, MAX_LIST),
    forskelle: forskelle.sort(sort).slice(0, MAX_LIST),
    antal: { mangler: mangler.length, dubletter: dubletter.length, forskelle: forskelle.length }
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
