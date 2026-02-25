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
  return Array.from(new Set((arr || []).filter(Boolean).map(x => String(x).trim())))
    .sort((a,b)=>a.localeCompare(b, "da"));
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

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function sortLinks(arr){
  return (arr || []).slice().sort((a,b)=> (a.sort ?? 1000) - (b.sort ?? 1000));
}
function groupBy(arr, keyFn){
  const m = new Map();
  for (const x of (arr || [])) {
    const k = (keyFn(x) ?? "").toString();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function renderTileHTML(it){
  const target = (it.openMode || "newTab") === "sameTab" ? "_self" : "_blank";
  return `
    <a class="tile" href="${esc(it.url)}" target="${target}" rel="noopener">
      <div class="tileTop">
        <div class="icon">${esc(it.icon || "🔗")}</div>
        <div class="badge">${esc(it.category || "")}</div>
      </div>
      <div class="tileTitle">${esc(it.title || "Uden titel")}</div>
      <div class="tileUrl">${esc(it.url || "")}</div>
    </a>
  `;
}

// Favorit-gruppe (fold ud/ind)
function renderFavGroupHTML(groupName, links, key) {
  const id = `fav_${key}`;
  const label = groupName || "Uden gruppe";
  const count = links.length;

  return `
    <div class="favGroup" style="border:1px solid rgba(0,0,0,.08); border-radius:10px; overflow:hidden; margin:10px 0; background:#fff;">
      <button class="favGroupHdr" type="button" data-toggle="${id}" aria-expanded="false"
        style="width:100%; display:flex; align-items:center; gap:10px; padding:12px 14px; background:#f7f7f7; border:0; cursor:pointer; font:inherit;">
        <span style="font-size:18px;">📁</span>
        <span style="font-weight:700; flex:1; text-align:left;">${esc(label)}</span>
        <span style="font-size:12px; opacity:.7; padding:2px 8px; border-radius:999px; background: rgba(0,0,0,.06);">${count}</span>
        <span class="favChevron" style="transition:transform .15s ease;">▾</span>
      </button>

      <div class="favGroupBody" id="${id}" hidden style="padding:12px 14px;">
        <div class="grid">
          ${sortLinks(links).map(renderTileHTML).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderCategorySectionHTML(categoryName, links, sectionIndex) {
  const cat = categoryName || "Andet";
  const isFav = cat.toLowerCase() === "favoritter";

  if (isFav) {
    const byGroup = groupBy(links, x => (x.group || "").trim() || "Uden gruppe");
    const groups = Array.from(byGroup.entries()).sort((a,b)=>a[0].localeCompare(b[0], "da"));

    return `
      <section class="section" style="margin:18px 0 26px;">
        <div class="accent-bar" style="margin-bottom:10px;">${esc(cat)}</div>
        <div class="sectionBody">
          ${groups.map(([g, ls], i) => renderFavGroupHTML(g, ls, `${sectionIndex}_${i}`)).join("")}
        </div>
      </section>
    `;
  }

  return `
    <section class="section" style="margin:18px 0 26px;">
      <div class="accent-bar" style="margin-bottom:10px;">${esc(cat)}</div>
      <div class="sectionBody">
        <div class="grid">
          ${sortLinks(links).map(renderTileHTML).join("")}
        </div>
      </div>
    </section>
  `;
}

function wireAccordions(root){
  root.querySelectorAll("[data-toggle]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-toggle");
      const body = document.getElementById(id);
      const isOpen = btn.getAttribute("aria-expanded") === "true";

      btn.setAttribute("aria-expanded", String(!isOpen));
      if (body) body.hidden = isOpen;

      // chevron flip (inline style)
      const ch = btn.querySelector(".favChevron");
      if (ch) ch.style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";
    });
  });
}

function renderSections(items) {
  const root = document.getElementById("sections");
  if (!root) return;

  // Favoritter først, resten alfabetisk
  const byCat = groupBy(items, x => (x.category || "Andet").trim() || "Andet");
  const entries = Array.from(byCat.entries()).sort((a,b)=>{
    const an = a[0].toLowerCase(), bn = b[0].toLowerCase();
    if (an === "favoritter" && bn !== "favoritter") return -1;
    if (bn === "favoritter" && an !== "favoritter") return 1;
    return a[0].localeCompare(b[0], "da");
  });

  root.innerHTML = entries.map(([cat, links], i) => renderCategorySectionHTML(cat, links, i)).join("");
  wireAccordions(root);
}

(async function init(){
  const me = await getMe();
  const roles = normRoles(me?.userRoles || []);
  document.getElementById("userLine").textContent = me ? `${me.userDetails}` : "Ikke logget ind";

  // (du kan senere gøre denne role-baseret igen)
  document.getElementById("adminLink").classList.remove("hidden");

  const raw = await loadLinks();
  const itemsAll = (raw || [])
    .map(x => ({
      ...x,
      allowedRoles: parseAllowedRoles(x.allowedRoles),
      enabled: x.enabled !== false
    }))
    .filter(x => x.enabled)
    // .filter(x => matchesRoles(normRoles(x.allowedRoles), roles))
    .sort((a,b)=> (a.sort ?? 1000) - (b.sort ?? 1000));

  // Filters (samme som før)
  const categories = uniq(itemsAll.map(x => x.category));
  const groups = uniq(itemsAll.map(x => x.group).filter(Boolean));

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

    const filtered = itemsAll.filter(x => {
      if (cat && (x.category || "") !== cat) return false;

      // gruppe-filter giver mest mening for Favoritter, men virker generelt
      if (grp && (x.group || "") !== grp) return false;

      if (!qq) return true;
      return (x.title||"").toLowerCase().includes(qq) || (x.url||"").toLowerCase().includes(qq);
    });

    renderSections(filtered);
  }

  render();
})();
