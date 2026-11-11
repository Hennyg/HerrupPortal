// api/employee-private-list/index.js
// GET /api/employee-private-list
// Oplysninger fra cr1eb_lch_medarbejderes for ALLE medarbejdere på én gang –
// bruges til "Personaleliste"-udskriften på herrup.html (fx bestilling til
// firmaarrangementer). Samme synlighedsregler som /api/employee-private:
//   - allergier/diabetes/andet: kun hvis personen har valgt "alle", eller den
//     indloggede er leder (har medarbejdere under sig), portal_loen eller admin
//   - fødselsdag: hele datoen kun for admin/personen selv, ellers dag+måned
//   - privat telefon: kun hvis personen har valgt at vise den
const N = require("../_news");
const M = require("../_medarbejder");
const { F } = M;

const ADMIN_ROLES = ["portal_admin", "portal_herrup_portal_admin"];

module.exports = async function (context, req) {
  const me = N.getPrincipal(req);
  if (!me) return N.json(context, 401, { error: "Ikke logget ind" });

  try {
    let roles = me.roles || [];
    try { roles = await N.lookupRoles(me); } catch (e) { context.log("Roller kunne ikke slås op:", e.message); }
    const isAdmin = roles.some(r => ADMIN_ROLES.includes(r));
    const graphToken = await N.graphToken();
    const lederAccess = isAdmin || await M.viewerIsLeder(graphToken, me.userId, roles);
    const myEmail = String(me.email || "").toLowerCase();

    const select = [
      F.mail, F.privatTlf, F.telefonVises,
      F.altMail, F.techId, F.fodselsdag,
      F.allergier, F.diabetes, F.helbredAndet, F.helbredSynlighed
    ].join(",");
    const rows = await M.dvGetAll(`${M.TABLE}?$select=${select}`);

    const out = rows
      .filter(r => r[F.mail])
      .map(r => {
        const mail = String(r[F.mail]).trim().toLowerCase();
        const isSelf = mail === myEmail;
        const synlighed = M.helbredSynlighed(r[F.helbredSynlighed]);
        const helbredVisible = lederAccess || isSelf || synlighed === "alle";
        const fd = M.validDate(r[F.fodselsdag]) ? r[F.fodselsdag] : null;
        return {
          mail,
          altMail: r[F.altMail] || "",
          techId: r[F.techId] || "",
          privatTlf: M.fromJaNej(r[F.telefonVises]) ? (r[F.privatTlf] || "") : "",
          fodselsdag: (isAdmin || isSelf) ? fd : null,
          fodselsdagMd: fd ? M.monthDay(fd) : null,
          helbredVisible,
          allergier: helbredVisible ? (r[F.allergier] || "") : "",
          diabetes: helbredVisible ? M.fromJaNej(r[F.diabetes]) : false,
          helbredAndet: helbredVisible ? (r[F.helbredAndet] || "") : ""
        };
      });

    return N.json(context, 200, { lederAccess, rows: out });
  } catch (e) {
    context.log("employee-private-list ERROR:", e.message);
    return N.json(context, 500, { error: e.message });
  }
};
