// assets/newsCommon.js – fælles hjælpere til nyhedssiderne
(function () {
  "use strict";

  const TYPE_LABEL = { nyhed: "Nyhed", olkassemode: "Ølkassemøde", tip: "Tip" };
  const EDITOR_ROLES = ["portal_hp_nyheder", "portal_admin", "portal_herrup_portal_admin"];

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function fmtDate(d, withTime = false) {
    if (!d) return "";
    const opts = { day: "numeric", month: "long", year: "numeric" };
    if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
    return new Date(d).toLocaleString("da-DK", opts);
  }

  function typeBadge(type) {
    return `<span class="newsTypeBadge ${esc(type)}">${esc(TYPE_LABEL[type] || "Nyhed")}</span>`;
  }

  // Roller fra login (kun til at vise/skjule knapper – API'et tjekker selv)
  let mePromise = null;
  function getMe() {
    if (!mePromise) {
      mePromise = fetch("/.auth/me", { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          const p = j?.clientPrincipal || null;
          const roles = new Set((p?.userRoles || []).map(r => String(r).toLowerCase()));
          (p?.claims || []).forEach(c => {
            const t = String(c.typ || "").toLowerCase();
            if (t === "roles" || t === "role" || t.endsWith("/identity/claims/role")) roles.add(String(c.val || "").toLowerCase());
          });
          return { email: p?.userDetails || "", roles: [...roles] };
        })
        .catch(() => ({ email: "", roles: [] }));
    }
    return mePromise;
  }
  async function isEditor() {
    const me = await getMe();
    return me.roles.some(r => EDITOR_ROLES.includes(r));
  }

  // Video: accepterer Stream-integreringskode (<iframe …>) eller et link.
  // Returnerer { embed } hvis den kan vises i siden, ellers { link }.
  function parseVideo(input) {
    let s = String(input || "").trim();
    if (!s) return null;
    const m = /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(s);
    if (m) s = m[1];
    s = s.replace(/&amp;/g, "&");
    let u;
    try { u = new URL(s); } catch { return null; }
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    const isSharePoint = host.endsWith(".sharepoint.com");
    if (isSharePoint && /\/_layouts\/15\/embed\.aspx/i.test(u.pathname)) return { embed: u.href };
    if (host === "www.youtube.com" && u.pathname.startsWith("/embed/")) return { embed: u.href };
    return { link: u.href };
  }

  function userLine() {
    getMe().then(me => {
      const el = document.getElementById("userLine");
      if (el) el.textContent = me.email || "";
    });
  }

  window.NewsCommon = { TYPE_LABEL, esc, fmtDate, typeBadge, getMe, isEditor, parseVideo, userLine };
})();
