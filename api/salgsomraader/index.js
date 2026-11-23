// api/salgsomraader/index.js
// GET /api/salgsomraader → { omraader: [{ navn, intervaller: [[fra, til], …] }] }
//
// Salgsområderne er defineret ud fra postnumre i app settings:
//   salgnord, salgmidt, salgost, salgvest
// Værdien er postnumre og intervaller adskilt af komma, semikolon eller mellemrum,
// fx  "7000-7499, 8000-8999, 9500"
// Kundesiden finder salgsområdet ud fra postnummeret på kundens adresse(r).

const N = require("../_news");

const OMRAADER = [
  { key: "salgnord", navn: "Nord" },
  { key: "salgmidt", navn: "Midt" },
  { key: "salgost",  navn: "Øst"  },
  { key: "salgvest", navn: "Vest" }
];

// Find app setting uanset store/små bogstaver
function setting(key) {
  const k = Object.keys(process.env).find(x => x.toLowerCase() === key.toLowerCase());
  return k ? String(process.env[k] || "") : "";
}

function parse(v) {
  const out = [];
  for (const t of String(v || "").split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)) {
    const m = /^(\d{3,4})\s*-\s*(\d{3,4})$/.exec(t);
    if (m) { const a = +m[1], b = +m[2]; out.push([Math.min(a, b), Math.max(a, b)]); continue; }
    if (/^\d{3,4}$/.test(t)) out.push([+t, +t]);
  }
  return out;
}

module.exports = async function (context, req) {
  if (!N.getPrincipal(req)) return N.json(context, 401, { error: "Ikke logget ind" });
  const omraader = OMRAADER
    .map(o => ({ navn: o.navn, intervaller: parse(setting(o.key)) }))
    .filter(o => o.intervaller.length);
  return N.json(context, 200, { omraader });
};
