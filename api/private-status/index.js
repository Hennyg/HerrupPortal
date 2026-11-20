// api/private-status/index.js
// GET /api/private-status
// Status til forsiden: hvor mange medarbejdere har udfyldt deres personlige
// oplysninger? Returnerer KUN optællinger + den indloggedes egen status –
// aldrig andres data.
//
// "Udfyldt" = privat adresse og mindst én nødkontakt (privat telefon tæller ikke med).
// Et felt, der er tomt, tæller som ikke udfyldt.
// Kun aktive medlemmer af gruppen "Alle - lely center herrup" tælles med
// (samme gruppe som personalelisten på herrup.html).

const N = require("../_news");
const M = require("../_medarbejder");
const { F } = M;

const GROUP_NAME = "Alle - lely center herrup";
const CACHE_MS = 5 * 60 * 1000;

let cache = { at: 0, data: null };

const filled = (v) => String(v ?? "").trim().length > 0;

function hasNoedKontakt(raw) {
  if (!filled(raw)) return false;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.some(c => c && (filled(c.navn) || filled(c.telefon)));
  } catch {
    return false;
  }
}

async function groupMemberMails(token) {
  const filter = encodeURIComponent(`displayName eq '${GROUP_NAME}'`);
  const g = await N.graphJson(token, `groups?$filter=${filter}&$select=id`);
  const groupId = g.value?.[0]?.id;
  if (!groupId) throw new Error(`Gruppe ikke fundet: "${GROUP_NAME}"`);

  const mails = new Set();
  let url = `groups/${groupId}/transitiveMembers/microsoft.graph.user?$select=mail,userPrincipalName,accountEnabled&$top=999`;
  for (let guard = 0; url && guard < 50; guard++) {
    const j = await N.graphJson(token, url);
    for (const u of j.value || []) {
      if (u.accountEnabled === false) continue;
      const mail = String(u.mail || u.userPrincipalName || "").trim().toLowerCase();
      if (mail) mails.add(mail);
    }
    url = j["@odata.nextLink"] || null;
  }
  return mails;
}

async function loadStatus() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  const token = await N.graphToken();
  const [members, rows] = await Promise.all([
    groupMemberMails(token),
    M.dvGetAll(`${M.TABLE}?$select=${[F.mail, F.privatAdresse, F.privatTlf, F.noedKontakter].join(",")}`)
  ]);

  // Status pr. medarbejder (kun medlemmer af gruppen)
  const byMail = new Map();
  for (const r of rows) {
    const mail = String(r[F.mail] || "").trim().toLowerCase();
    if (!mail || !members.has(mail)) continue;
    const s = {
      adresse: filled(r[F.privatAdresse]),
      telefon: filled(r[F.privatTlf]),
      noed:    hasNoedKontakt(r[F.noedKontakter])
    };
    // Er der flere rækker for samme person, tæller den bedste
    const prev = byMail.get(mail);
    if (prev) {
      s.adresse ||= prev.adresse;
      s.telefon ||= prev.telefon;
      s.noed    ||= prev.noed;
    }
    byMail.set(mail, s);
  }

  let complete = 0, adresse = 0, telefon = 0, noed = 0;
  for (const s of byMail.values()) {
    if (s.adresse) adresse++;
    if (s.telefon) telefon++;
    if (s.noed) noed++;
    if (s.adresse && s.noed) complete++;
  }

  const data = { total: members.size, complete, adresse, telefon, noed, members, byMail, updated: new Date().toISOString() };
  cache = { at: Date.now(), data };
  return data;
}

module.exports = async function (context, req) {
  const me = N.getPrincipal(req);
  if (!me) return N.json(context, 401, { error: "Ikke logget ind" });

  try {
    const d = await loadStatus();
    const myMail = String(me.email || "").trim().toLowerCase();
    const mine = d.byMail.get(myMail) || { adresse: false, telefon: false, noed: false };

    return N.json(context, 200, {
      total: d.total,
      complete: d.complete,
      adresse: d.adresse,
      telefon: d.telefon,
      noed: d.noed,
      updated: d.updated,
      me: {
        member: d.members.has(myMail),
        adresse: mine.adresse,
        telefon: mine.telefon,
        noed: mine.noed,
        complete: mine.adresse && mine.noed
      }
    });
  } catch (e) {
    context.log("private-status ERROR:", e.message);
    return N.json(context, 500, { error: e.message });
  }
};
