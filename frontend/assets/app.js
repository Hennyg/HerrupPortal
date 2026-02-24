
async function getMe() {
  const r = await fetch("/.auth/me");
  if (!r.ok) return null;
  const j = await r.json();
  return j?.clientPrincipal || null;
}

function normRoleList(roles) {
  return (roles || []).map(r => String(r).toLowerCase());
}

function hasRole(roles, role) {
  return roles.includes(String(role).toLowerCase());
}

function matchesRoles(itemRoles, userRoles) {
  if (!itemRoles || !itemRoles.length) return true; // hvis tom => vis for alle authenticated
  const set = new Set(userRoles);
  return itemRoles.some(r => set.has(String(r).toLowerCase()));
}

async function loadLinks() {
  // Forventet API: /api/links -> [{ id,title,url,category,icon,allowedRoles,enabled,sort,openMode }]
  try {
    const r = await fetch("/api/links");
    if (!r.ok) throw new Error("api_not_ok");
    return await r.json();
  } catch {
    // Fallback demo-data (så siden virker med det samme)
    return [
      { id:"1", title:"CHR Portal", url:"https://example.com/chr", category:"Static Apps", icon:"🐄", allowedRoles:["portal_user"], enabled:true, sort:10, openMode:"newTab" },
      { id:"2", title:"Flyveborde", url:"https://example.com/flyveborde", category:"Static Apps", icon:"🪑", allowedRoles:["portal_user"], enabled:true, sort:20, openMode:"newTab" },
      { id:"3", title:"Admin", url:"/admin.html", category:"Værktøjer", icon:"⚙️", allowedRoles:["portal_admin"], enabled:true, sort:999, openMode:"sameTab" }
    ];
  }
}

function parseAllowedRoles(s) {
  if (Array.isArray(s)) return s.map(x => String(x).trim()).filter(Boolean);
  return String(s || "")
    .split(";")
    .map(x => x.trim())
    .filter(Boolean);
}

function renderCats(cats, state) {
  const wrap = document.getElementById("cats");
  wrap.innerHTML = "";

  const all = document.createElement("button");
  all.className = "chip" + (!state.cat ? " active" : "");
  all.textContent = "Alle";
  all.onclick = () => { state.cat = ""; renderAll(state); };
  wrap.appendChild(all);

  cats.forEach(c => {
    const b = document.createElement("button");
    b.className = "chip" + (state.cat === c ? " active" : "");
    b.textContent = c;
    b.onclick = () => { state.cat = c; renderAll(state); };
    wrap.appendChild(b);
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

function renderAll(state) {
  const q = (state.q || "").toLowerCase();
  const filtered = state.items
    .filter(x => !state.cat || (x.category || "") === state.cat)
    .filter(x => {
      const t = (x.title || "").toLowerCase();
      const u = (x.url || "").toLowerCase();
      return !q || t.includes(q) || u.includes(q);
    })
    .sort((a,b) => (a.sort ?? 1000) - (b.sort ?? 1000));

  renderGrid(filtered);
}

(async function init() {
  const me = await getMe();
  const userLine = document.getElementById("userLine");
  const adminBtn = document.getElementById("adminBtn");

  const roles = normRoleList(me?.userRoles || []);
  userLine.textContent = me
    ? `${me.userDetails} (${roles.join(", ")})`
    : "Ikke logget ind";

  if (hasRole(roles, "portal_admin")) adminBtn.classList.remove("hidden");

  const raw = await loadLinks();
  const items = raw
    .map(x => ({
      ...x,
      allowedRoles: parseAllowedRoles(x.allowedRoles),
      enabled: x.enabled !== false
    }))
    .filter(x => x.enabled)
    .filter(x => matchesRoles(normRoleList(x.allowedRoles), roles));

  const cats = Array.from(new Set(items.map(x => x.category).filter(Boolean))).sort();

  const state = { items, cat:"", q:"" };
  renderCats(cats, state);
  renderAll(state);

  document.getElementById("q").addEventListener("input", (e) => {
    state.q = e.target.value || "";
    renderAll(state);
  });

  // PWA: registrér service worker (stille og roligt)
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/service-worker.js"); } catch {}
  }
})();
