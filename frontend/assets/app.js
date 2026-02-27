// assets/app.js

// Slå tracking til/fra (du har pt. ikke /api/track => hold den false)
const TRACKING_ENABLED = false;

// ---------------------------
// Utils / tracking
// ---------------------------
function safeUrl(u) {
  // Undgå at logge alt muligt persondata i querystring.
  // Returnér gerne kun origin+path, eller begræns querystring.
  try {
    const url = new URL(u, location.origin);
    return url.origin + url.pathname + (url.search ? url.search.substring(0, 200) : "");
  } catch {
    return String(u || "").substring(0, 500);
  }
}

async function track(eventType, extra = {}) {
  if (!TRACKING_ENABLED) return;

  try {
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        pageUrl: safeUrl(location.href),
        path: location.pathname,
        referrer: safeUrl(document.referrer || ""),
        tsLocal: new Date().toISOString(),
        ...extra
      })
    });
  } catch {
    // Tracking må aldrig ødelægge UX – ignorér fejl.
  }
}

// Log ét "PageView" når siden åbnes
document.addEventListener("DOMContentLoaded", () => {
  track("PageView");
});

function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  const isMobileUA = /iphone|ipad|android|mobile/.test(ua);
  const isSmallScreen = window.matchMedia("(max-width: 900px)").matches;
  return (isMobileUA || isSmallScreen) ? "mobile" : "desktop";
}

// ---------------------------
// Auth / roles
// ---------------------------
async function getMe() {
  const r = await fetch("/.auth/me", { cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  // SWA: j.clientPrincipal indeholder userDetails + userRoles
  return j?.clientPrincipal || null;
}

function normRoles(roles) {
  return (roles || []).map(r => String(r).toLowerCase());
}

function expandRoles(roles) {
  const set = new Set(normRoles(roles));

  // Hierarki: admin skal også have user
  if (set.has("portal_admin")) set.add("portal_user");

  return [...set];
}

// ---------------------------
// Link filtering
// ---------------------------
function parseAllowedRoles(s) {
  if (Array.isArray(s)) {
    return s.map(x => String(x).trim().toLowerCase()).filter(Boolean);
  }
  return String(s || "")
    .split(";")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
}

function matchesRoles(itemRoles, userRoles) {
  // Ingen krav => vis for alle (authenticated siden er låst af SWA routes)
  if (!itemRoles || itemRoles.length === 0) return true;

  const set = new Set(normRoles(userRoles));
  return itemRoles.some(r => set.has(String(r).toLowerCase()));
}

async function loadLinks() {
  // Din løsning bruger /api/links-admin
  const r = await fetch("/api/links-admin", { cache: "no-store" });
  if (!r.ok) throw new Error(`api_not_ok_${r.status}`);
  return await r.json();
}

// ---------------------------
// UI helpers
// ---------------------------
function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean).map(x => String(x).trim())))
    .sort((a, b) => a.localeCompare(b, "da"));
}

function setSelectOptions(selectEl, options, { includeEmpty = true, emptyText = "Alle" } = {}) {
  if (!selectEl) return;
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

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function sortLinks(arr) {
  return (arr || []).slice().sort((a, b) => (a.sort ?? 1000) - (b.sort ?? 1000));
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of (arr || [])) {
    const k = (keyFn(x) ?? "").toString();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// ---------------------------
// Rendering
// ---------------------------
function renderTileHTML(it) {
  const target = (it.openMode || "newTab") === "sameTab" ? "_self" : "_blank";
  return `
    <a class="tile"
       href="${esc(it.url)}"
       target="${target}"
       rel="noopener"
       data-track="tile"
       data-title="${esc(it.title || "")}"
       data-url="${esc(it.url || "")}"
       data-category="${esc(it.category || "")}"
       data-group="${esc(it.group || "")}">
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
    const groups = Array.from(byGroup.entries()).sort((a, b) => a[0].localeCompare(b[0], "da"));

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

function wireAccordions(root) {
  root.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-toggle");
      const body = document.getElementById(id);
      const isOpen = btn.getAttribute("aria-expanded") === "true";

      btn.setAttribute("aria-expanded", String(!isOpen));
      if (body) body.hidden = isOpen;

      const ch = btn.querySelector(".favChevron");
      if (ch) ch.style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";
    });
  });
}

function wireTileTracking(root) {
  root.querySelectorAll('a.tile[data-track="tile"]').forEach(a => {
    a.addEventListener("click", () => {
      const targetUrl = a.getAttribute("data-url") || a.href || "";
      const title = a.getAttribute("data-title") || a.textContent || "";
      const category = a.getAttribute("data-category") || "";
      const group = a.getAttribute("data-group") || "";

      track("Click", {
        targetUrl: safeUrl(targetUrl),
        targetTitle: title.substring(0, 200),
        targetCategory: category.substring(0, 100),
        targetGroup: group.substring(0, 100)
      });
    }, { passive: true });
  });
}

function renderSections(items) {
  const root = document.getElementById("sections");
  if (!root) return;

  // Favoritter først, resten alfabetisk
  const byCat = groupBy(items, x => (x.category || "Andet").trim() || "Andet");
  const entries = Array.from(byCat.entries()).sort((a, b) => {
    const an = a[0].toLowerCase(), bn = b[0].toLowerCase();
    if (an === "favoritter" && bn !== "favoritter") return -1;
    if (bn === "favoritter" && an !== "favoritter") return 1;
    return a[0].localeCompare(b[0], "da");
  });

  root.innerHTML = entries.map(([cat, links], i) => renderCategorySectionHTML(cat, links, i)).join("");
  wireAccordions(root);
  wireTileTracking(root);
}

// ---------------------------
// Init
// ---------------------------
(async function init() {
  const userLine = document.getElementById("userLine");
  if (userLine) userLine.textContent = "Henter bruger...";

  let me = null;
  try {
    me = await getMe();
  } catch {
    me = null;
  }

  function rolesFromMe(me) {
  if (!me) return [];

  const fromUserRoles = (me.userRoles || []).map(r => r.toLowerCase());

  const fromClaims = (me.claims || [])
    .filter(c => String(c.typ).toLowerCase() === "roles")
    .map(c => String(c.val).toLowerCase());

  return Array.from(new Set([...fromUserRoles, ...fromClaims]));
}

const roles = expandRoles(rolesFromMe(me));

  // Vis bruger
  if (userLine) userLine.textContent = me?.userDetails || "Ikke logget ind";

  // Admin link i navbar
  const adminLink = document.getElementById("adminLink");
  if (adminLink) {
    adminLink.classList.toggle("hidden", !roles.includes("portal_admin"));
  }

  // Hent links
  let raw = [];
  try {
    raw = await loadLinks();
  } catch (e) {
    console.warn("Kunne ikke hente links:", e);
    // Vis tomt (eller du kan vise en fejlbesked i UI hvis du vil)
    renderSections([]);
    return;
  }

  const platform = detectPlatform();
  console.log("Platform detected:", platform);

  const itemsAll = (raw || [])
    .map(x => ({
      ...x,
      allowedRoles: parseAllowedRoles(x.allowedRoles),
      enabled: x.enabled !== false,
      platformHint: (x.platformHint || "all").toLowerCase()
    }))
    .filter(x => x.enabled)
    .filter(x => x.platformHint === "all" || x.platformHint === platform)
    .filter(x => matchesRoles(x.allowedRoles, roles))
    .sort((a, b) => (a.sort ?? 1000) - (b.sort ?? 1000));

  // Filters
  const categories = uniq(itemsAll.map(x => x.category));
  const groups = uniq(itemsAll.map(x => x.group).filter(Boolean));

  const catSel = document.getElementById("categoryFilter");
  const grpSel = document.getElementById("groupFilter");
  setSelectOptions(catSel, categories, { includeEmpty: true, emptyText: "Alle kategorier" });
  setSelectOptions(grpSel, groups, { includeEmpty: true, emptyText: "Alle grupper" });

  const q = document.getElementById("q");
  const qx = document.getElementById("qx");

  function syncClearBtn() {
    if (!qx || !q) return;
    qx.style.visibility = q.value ? "visible" : "hidden";
  }

  function render() {
    const qq = (q?.value || "").toLowerCase();
    const cat = catSel?.value || "";
    const grp = grpSel?.value || "";

    const filtered = itemsAll.filter(x => {
      if (cat && (x.category || "") !== cat) return false;
      if (grp && (x.group || "") !== grp) return false;

      if (!qq) return true;
      return (x.title || "").toLowerCase().includes(qq) || (x.url || "").toLowerCase().includes(qq);
    });

    renderSections(filtered);
  }

  if (q) q.addEventListener("input", () => { syncClearBtn(); render(); });
  if (qx) qx.addEventListener("click", () => { q.value = ""; syncClearBtn(); render(); });
  if (catSel) catSel.addEventListener("change", render);
  if (grpSel) grpSel.addEventListener("change", render);

  syncClearBtn();
  render();
})();
