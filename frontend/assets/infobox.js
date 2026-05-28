// assets/infobox.js
// Håndterer admin-infoboksen og rød-ring-forklaringen på forsiden.
// Boksen vises kun for portal_admin.
// Beskeden gemmes i /api/links-admin som et særligt "infobox"-record,
// og vises for alle brugere som en lille forklaring under hero.

(async function initInfoBox() {
  const INFOBOX_KEY = "__infobox__";

  const box       = document.getElementById("adminInfoBox");
  const textarea  = document.getElementById("adminInfoText");
  const saveBtn   = document.getElementById("adminInfoSave");
  const clearBtn  = document.getElementById("adminInfoClear");
  const status    = document.getElementById("adminInfoStatus");
  const legend    = document.getElementById("ringLegend");
  const legendTxt = document.getElementById("ringLegendText");

  if (!box) return;

  // Hent brugerroller fra det allerede-indlæste /.auth/me
  async function isAdmin() {
    try {
      const r = await fetch("/.auth/me", { cache: "no-store" });
      if (!r.ok) return false;
      const j = await r.json();
      const roles = (j?.clientPrincipal?.userRoles || []).map(x => x.toLowerCase());
      return roles.includes("portal_admin");
    } catch { return false; }
  }

  // Hent gemt besked fra localStorage (simpel persistens uden ekstra API)
  function loadMsg() {
    try { return localStorage.getItem(INFOBOX_KEY) || ""; } catch { return ""; }
  }

  function saveMsg(txt) {
    try { localStorage.setItem(INFOBOX_KEY, txt); } catch {}
  }

  // Vis legend for alle brugere hvis der er en besked
  function updateLegend(txt) {
    if (!legend || !legendTxt) return;
    const trimmed = (txt || "").trim();
    if (trimmed) {
      legendTxt.textContent = trimmed;
      legend.classList.add("visible");
    } else {
      legend.classList.remove("visible");
    }
  }

  // Altid: vis legend hvis der er en gemt besked
  const existing = loadMsg();
  updateLegend(existing);

  const admin = await isAdmin();
  if (!admin) return;

  // Vis admin-boksen
  box.classList.add("visible");
  if (textarea) textarea.value = existing;

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const txt = textarea?.value || "";
      saveMsg(txt);
      updateLegend(txt);
      if (status) {
        status.textContent = "Gemt ✅";
        setTimeout(() => { if (status) status.textContent = ""; }, 2500);
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (textarea) textarea.value = "";
      saveMsg("");
      updateLegend("");
      if (status) {
        status.textContent = "Ryddet";
        setTimeout(() => { if (status) status.textContent = ""; }, 2000);
      }
    });
  }
})();
