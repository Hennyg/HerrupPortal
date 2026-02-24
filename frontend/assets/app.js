async function getMe() {
  const r = await fetch("/.auth/me");
  if (!r.ok) return null;
  const j = await r.json();
  return j?.clientPrincipal || null;
}
const normRoles = (roles) => (roles || []).map(r => String(r).toLowerCase());
const hasRole = (roles, role) => roles.includes(String(role).toLowerCase());

function parseAllowedRoles(s) {
  if (Array.isArray(s)) return s.map(x => String(x).trim()).filter(Boolean);
  return String(s || "").split(";").map(x => x.trim()).filter(Boolean);
}
function matchesRoles(itemRoles, userRoles) {
  if (!itemRoles || !itemRoles.length) return true;
  const set = new Set(userRoles);
  return itemRoles.some(r => set.has(String(r).toLowerCase()));
}

async function loadLinks() {
  const r = await fetch("/api/links-admin");
  if (!r.ok) throw new Error("api_not_ok");
  return await r.json();
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean).map(x => String(x).trim()))).sort((a,b)=>a.localeCompare(b));
}
function setSelectOptions(selectEl, options, { includeEmpty=true, emptyText="Alle" } = {}) {
  selectEl.innerHTML = "";
  if (includeEmpty) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = emptyText;
    selectEl.appendChild(o);
  }
  options.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    selectEl.appendChild(o);
  });
}

function renderGrid(items) {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  items.forEach(it => {
    const a = document.createElement("a");
    a.className = "tile";
    a.href = it.url;
    a.target = (it.openMode || "newTab") === "sameTab" ? "_self" : "_blank";
    a.rel = "noopener";
    a.innerHTML = `
      <div class="tileTop">
        <div class="icon">${it.icon || "🔗"}</div>
        <div class="badge">${it.category || ""}</div>
      </div>
      <div class="tileTitle">${it.title || "Uden titel"}</div>
      <div class="tileUrl">${it.url || ""}</div>
    `;
    grid.appendChild(a);
  });
}

(async function init(){
  const me = await getMe();
  const roles = normRoles(me?.userRoles || []);
  document.getElementById("userLine").textContent = me ? `${me.userDetails}` : "Ikke logget ind";

document.getElementById("adminLink").classList.remove("hidden");


  const raw = await loadLinks();
  const items = (raw || [])
    .map(x => ({
      ...x,
      allowedRoles: parseAllowedRoles(x.allowedRoles),
      enabled: x.enabled !== false
    }))
    .filter(x => x.enabled)
    .filter(x => matchesRoles(normRoles(x.allowedRoles), roles))
    .sort((a,b)=> (a.sort ?? 1000) - (b.sort ?? 1000));

  const categories = uniq(items.map(x => x.category));
  const groups = uniq(items.map(x => x.group));

  const catSel = document.getElementById("categoryFilter");
  const grpSel = document.getElementById("groupFilter");
  setSelectOptions(catSel, categories, { includeEmpty:true, emptyText:"Alle kategorier" });
  setSelectOptions(grpSel, groups, { includeEmpty:true, emptyText:"Alle grupper" });

  const q = document.getElementById("q");
  const qx = document.getElementById("qx");
  function syncClearBtn(){
    qx.style.visibility = q.value ? "visible" : "hidden";
  }
  q.addEventListener("input", () => { syncClearBtn(); render(); });
  qx.addEventListener("click", () => { q.value=""; syncClearBtn(); render(); });
  catSel.addEventListener("change", render);
  grpSel.addEventListener("change", render);
  syncClearBtn();

  function render() {
    const qq = (q.value || "").toLowerCase();
    const cat = catSel.value;
    const grp = grpSel.value;

    const filtered = items.filter(x => {
      if (cat && (x.category || "") !== cat) return false;
      if (grp && (x.group || "") !== grp) return false;
      if (!qq) return true;
      return (x.title||"").toLowerCase().includes(qq) || (x.url||"").toLowerCase().includes(qq);
    });

    renderGrid(filtered);
  }

  render();
})();
