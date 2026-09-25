
// assets/app.js

// Slå tracking til/fra (du har pt. ikke /api/track => hold den false)
const TRACKING_ENABLED = false;

// ── "Mine favoritter" (stjernemarkering) ─────────────────────────────────────
// Hvilke link-id'er den indloggede bruger har markeret med stjernen. Gemmes
// centralt via /api/favoritter, så valget følger brugeren på tværs af enheder.
let favoriteIds = new Set();
let favSaveTimer = null;
// Sat af init() til dens lokale render(), så toggleFavorite() (som ligger
// uden for init-closuren) kan bede om et gentegn efter en stjerne skifter.
let rerenderMain = () => {};

async function loadFavorites() {
  try {
    const r = await fetch("/api/favoritter", { cache: "no-store" });
    if (!r.ok) { favoriteIds = new Set(); return; }
    const data = await r.json();
    favoriteIds = new Set(Array.isArray(data.ids) ? data.ids : []);
  } catch {
    // Offline/fejl: ingen favoritter markeret ved denne indlæsning — påvirker
    // ikke resten af siden, og intet gemmes før brugeren selv klikker en stjerne.
    favoriteIds = new Set();
  }
}

// ── Nyheder/tips i "Velkommen"-banneret ─────────────────────────────────────
// Henter alle aktive poster, blander rækkefølgen én gang og roterer hvert 10. sekund.
// En post markeres kort første gang den ses i denne browser. Hover pauser rotationen.
let newsRotationTimer = null;
let newsRotationItems = [];
let newsRotationIndex = 0;

function shuffleNews(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showNewsItem(item) {
  const title = document.getElementById("newsTitle");
  const text = document.getElementById("newsTip");
  const hero = title?.closest(".hero");
  if (!title || !text || !item) return;

  const icon = item.type === "tip" ? "💡" : (item.type === "olkassemode" ? "🍺" : "📢");
  title.textContent = item.overskrift || (item.type === "tip" ? "Tip" : "Nyhed");
  text.textContent = `${icon} ${item.indhold || ""}`.trim();

  // Hele tile'n er klikbar til nyheden (se wireNewsTile)
  const tile = document.getElementById("newsTile");
  if (tile && item.id) {
    tile.dataset.href = `/nyhed.html?id=${encodeURIComponent(item.id)}`;
    tile.classList.add("clickable");
    tile.setAttribute("role", "link");
    tile.tabIndex = 0;
    tile.title = "Åbn nyheden";
  }

  // "Læs mere" når nyheden har en længere tekst eller en video
  if (item.hasBody || item.videourl) {
    const a = document.createElement("a");
    a.className = "newsReadMore";
    a.href = `/nyhed.html?id=${encodeURIComponent(item.id)}`;
    a.textContent = "Læs mere →";
    text.appendChild(document.createTextNode(" "));
    text.appendChild(a);
  }

  if (hero && item.id) {
    const key = `herrup-news-seen-${item.id}`;
    let seen = false;
    try { seen = localStorage.getItem(key) === "1"; } catch {}
    hero.classList.remove("newsFirstSeen");
    if (!seen) {
      // Genstart animationen hvis to usete poster vises efter hinanden.
      void hero.offsetWidth;
      hero.classList.add("newsFirstSeen");
      try { localStorage.setItem(key, "1"); } catch {}
      setTimeout(() => hero.classList.remove("newsFirstSeen"), 2400);
    }
  }
}

// Pile i begge sider + klik på hele tile'n
function stepNews(dir) {
  if (newsRotationItems.length <= 1) return;
  newsRotationIndex = (newsRotationIndex + dir + newsRotationItems.length) % newsRotationItems.length;
  showNewsItem(newsRotationItems[newsRotationIndex]);
}

function wireNewsTile() {
  const tile = document.getElementById("newsTile");
  if (!tile || tile.dataset.wired) return;
  tile.dataset.wired = "1";
  const multi = newsRotationItems.length > 1;
  document.getElementById("newsPrev")?.classList.toggle("off", !multi);
  document.getElementById("newsNext")?.classList.toggle("off", !multi);
  document.getElementById("newsPrev")?.addEventListener("click", e => { e.stopPropagation(); stepNews(-1); });
  document.getElementById("newsNext")?.addEventListener("click", e => { e.stopPropagation(); stepNews(1); });

  const open = () => { if (tile.dataset.href) location.href = tile.dataset.href; };
  tile.addEventListener("click", e => {
    // Links og knapper inde i tile'n (bjælke, "Læs mere", pile) klarer sig selv
    if (e.target.closest("a, button")) return;
    open();
  });
  tile.addEventListener("keydown", e => {
    if (e.target !== tile) return;
    if (e.key === "Enter") open();
    if (e.key === "ArrowLeft") stepNews(-1);
    if (e.key === "ArrowRight") stepNews(1);
  });
}

function scheduleNewsRotation() {
  clearInterval(newsRotationTimer);
  if (newsRotationItems.length <= 1) return;
  newsRotationTimer = setInterval(() => {
    newsRotationIndex = (newsRotationIndex + 1) % newsRotationItems.length;
    showNewsItem(newsRotationItems[newsRotationIndex]);
  }, 10000);
}

async function loadNewsOrTip() {
  const title = document.getElementById("newsTitle");
  const text = document.getElementById("newsTip");
  const hero = title?.closest(".hero");
  if (!title || !text) return;

  try {
    const r = await fetch("/api/tips", { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    if (window.HerrupTicker) window.HerrupTicker.render(data?.banners || []);
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) {
      if (data?.error) console.warn("/api/tips:", data.error);
      return;
    }

    newsRotationItems = shuffleNews(items);
    newsRotationIndex = 0;
    showNewsItem(newsRotationItems[0]);
    scheduleNewsRotation();
    wireNewsTile();

    if (hero && !hero.dataset.newsRotationWired) {
      hero.dataset.newsRotationWired = "1";
      hero.addEventListener("mouseenter", () => clearInterval(newsRotationTimer));
      hero.addEventListener("mouseleave", scheduleNewsRotation);
    }
  } catch (e) {
    console.warn("Kunne ikke hente nyheder/tips:", e);
  }
}

function saveFavoritesDebounced() {
  clearTimeout(favSaveTimer);
  favSaveTimer = setTimeout(async () => {
    try {
      await fetch("/api/favoritter", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(favoriteIds) })
      });
    } catch (e) {
      console.warn("Kunne ikke gemme favoritter:", e);
    }
  }, 400);
}

function toggleFavorite(id) {
  if (!id) return;
  if (favoriteIds.has(id)) favoriteIds.delete(id);
  else favoriteIds.add(id);
  saveFavoritesDebounced();
  rerenderMain();
}

function safeUrl(u) {
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
  } catch {}
}

document.addEventListener("DOMContentLoaded", () => {
  track("PageView");
});

function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  const isMobileUA = /iphone|ipad|android|mobile/.test(ua);
  const isSmallScreen = window.matchMedia("(max-width: 900px)").matches;
  return (isMobileUA || isSmallScreen) ? "mobile" : "desktop";
}

async function getMe() {
  const r = await fetch("/.auth/me", { cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.clientPrincipal || null;
}

function normRoles(roles) {
  return (roles || []).map(r => String(r).toLowerCase());
}

function expandRoles(roles) {
  const set = new Set(normRoles(roles));
  if (set.has("portal_admin")) set.add("portal_user");
  return [...set];
}

function rolesFromMe(me) {
  if (!me) return [];
  const fromUserRoles = (me.userRoles || []).map(r => String(r).toLowerCase());
  const fromClaims = (me.claims || [])
    .filter(c => {
      const t = String(c.typ || "").toLowerCase();
      return t === "roles" || t === "role" || t.endsWith("/identity/claims/role");
    })
    .map(c => String(c.val || "").toLowerCase());
  return Array.from(new Set([...fromUserRoles, ...fromClaims]));
}

function parseAllowedRoles(s) {
  if (Array.isArray(s)) {
    return s.map(x => String(x).trim().toLowerCase()).filter(Boolean);
  }
  return String(s || "").split(";").map(x => x.trim().toLowerCase()).filter(Boolean);
}

function matchesRoles(itemRoles, userRoles) {
  if (!itemRoles || itemRoles.length === 0) return true;
  const set = new Set(userRoles);
  return itemRoles.some(r => set.has(r));
}

async function loadLinks() {
  const r = await fetch("/api/links", { cache: "no-store" });
  if (!r.ok) throw new Error(`api_not_ok_${r.status}`);
  return await r.json();
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean).map(x => String(x).trim())))
    .sort((a, b) => a.localeCompare(b, "da"));
}

function isImageIcon(v) {
  v = String(v || "").trim();
  return (
    /^data:image\//i.test(v) ||
    /^https?:\/\//i.test(v) ||
    v.startsWith("/") ||
    /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(v)
  );
}

function setIcon(el, iconValue) {
  const v = String(iconValue || "").trim();
  if (!el) return;
  if (v && isImageIcon(v)) {
    el.innerHTML = `<img src="${v}" alt="" style="max-height:40px;max-width:100%;width:auto;height:auto;object-fit:contain;">`;
  } else {
    el.textContent = v || "🔗";
  }
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
  return String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
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

function normKey(s) { return String(s ?? "").trim(); }
function normSubgroup(it) { return normKey(it.subgroup || it.subGroup || ""); }

// ── Medarbejdersøgning på en tile ───────────────────────────────────────────
// Et link, hvis URL peger på personalelisten (/herrup.html), vises som en
// almindelig tile — men i stedet for forklaringsteksten får den et søgefelt.
// Oprettes som et helt normalt link i Admin (URL: /herrup.html).
const EMPLOYEE_SEARCH_PATHS = ["/herrup.html"];

function isEmployeeSearchTile(it) {
  try {
    const u = new URL(it?.url || "", location.origin);
    if (u.origin !== location.origin) return false;
    return EMPLOYEE_SEARCH_PATHS.includes(u.pathname.toLowerCase());
  } catch {
    return false;
  }
}

function renderEmployeeSearchHTML() {
  return `
    <div class="empSearch">
      <input type="search" class="empSearchInput" placeholder="Søg medarbejder…" autocomplete="off" aria-label="Søg medarbejder">
      <div class="empSearchResults" hidden></div>
    </div>
  `;
}

let empSearchOutsideWired = false;

function closeAllEmployeeSearches(except) {
  document.querySelectorAll(".empSearch").forEach(box => {
    if (box === except) return;
    const res = box.querySelector(".empSearchResults");
    if (res) { res.hidden = true; res.innerHTML = ""; }
    box.closest(".tile")?.classList.remove("empOpen");
  });
}

function wireEmployeeSearch(root) {
  if (!empSearchOutsideWired) {
    empSearchOutsideWired = true;
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".empSearch")) closeAllEmployeeSearches();
    });
  }

  root.querySelectorAll(".empSearch").forEach(box => {
    const input   = box.querySelector(".empSearchInput");
    const results = box.querySelector(".empSearchResults");
    const tile    = box.closest(".tile");
    let debounceTimer = null;
    let activeFetch = 0;
    let lastList = [];

    function show(html) {
      results.innerHTML = html;
      results.hidden = false;
      tile?.classList.add("empOpen");
    }

    function hide() {
      results.hidden = true;
      results.innerHTML = "";
      tile?.classList.remove("empOpen");
    }

    function openPerson(id) {
      if (!id) return;
      window.open(`/herrup.html?person=${encodeURIComponent(id)}`, "_blank", "noopener");
      input.value = "";
      lastList = [];
      hide();
    }

    async function runSearch(q) {
      const myFetchId = ++activeFetch;
      show(`<div class="empSearchInfo">Søger…</div>`);
      try {
        let list;
        const entry = (typeof entraCacheRead === "function") ? await entraCacheRead() : null;

        if (entry && typeof entraCacheIsFresh === "function" && entraCacheIsFresh(entry)) {
          // Cache er varm — filtrer lokalt, ingen server-tur.
          const ql = q.toLowerCase();
          list = entry.data
            .filter(u => (u.displayName || "").toLowerCase().includes(ql) || (u.mail || "").toLowerCase().includes(ql))
            .slice(0, 15);
        } else {
          // Koldt cache — brug det lette søge-endpoint.
          const r = await fetch(`/api/entra-users-search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
          list = Array.isArray(data) ? data : [];
          if (typeof entraCacheWarm === "function") entraCacheWarm();
        }

        if (myFetchId !== activeFetch) return;
        lastList = list;
        renderResults(list);
      } catch (e) {
        if (myFetchId !== activeFetch) return;
        lastList = [];
        show(`<div class="empSearchInfo">Kunne ikke søge: ${esc(e.message)}</div>`);
      }
    }

    function renderResults(list) {
      if (!list.length) {
        show(`<div class="empSearchInfo">Ingen resultater</div>`);
        return;
      }
      show(list.map(u => `
        <button type="button" class="empSearchResult" data-id="${esc(u.id)}">${esc(u.displayName || "–")}</button>
      `).join(""));
      results.querySelectorAll(".empSearchResult").forEach(el => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openPerson(el.getAttribute("data-id"));
        });
      });
    }

    input.addEventListener("focus", () => closeAllEmployeeSearches(box));

    input.addEventListener("input", () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < 2) {
        activeFetch++;
        lastList = [];
        hide();
        return;
      }
      debounceTimer = setTimeout(() => runSearch(q), 300);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (lastList.length) openPerson(lastList[0].id);
      } else if (e.key === "Escape") {
        input.value = "";
        lastList = [];
        hide();
        input.blur();
      }
    });
  });
}

function renderTileHTML(it) {
  const target = (it.openMode || "newTab") === "sameTab" ? "_self" : "_blank";
  const isFavStarred = favoriteIds.has(it.id);
  const isEmpSearch = isEmployeeSearchTile(it);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="tile${isEmpSearch ? " empTile" : ""}">
      <button
        class="favStar${isFavStarred ? " is-active" : ""}"
        type="button"
        data-fav-id="${esc(it.id)}"
        aria-pressed="${isFavStarred ? "true" : "false"}"
        title="${isFavStarred ? "Fjern fra Mine favoritter" : "Tilføj til Mine favoritter"}"
      >${isFavStarred ? "★" : "☆"}</button>
      <a class="tileLink"
         href="${esc(it.url)}"
         target="${target}"
         rel="noopener"
         data-track="tile"
         data-title="${esc(it.title || "")}"
         data-url="${esc(it.url || "")}"
         data-category="${esc(it.category || "")}"
         data-group="${esc(it.group || "")}">
        <div class="tileTop">
          <div class="icon"></div>
        </div>
        <div class="tileTitle">${esc(it.title || "Uden titel")}</div>
        ${isEmpSearch ? "" : `<div class="tileUrl">${esc(it.description || it.forklaring || "")}</div>`}
      </a>
      ${isEmpSearch ? renderEmployeeSearchHTML() : ""}
    </div>
  `;
  const tileEl = wrapper.firstElementChild;
  setIcon(tileEl.querySelector(".icon"), it.icon);
  return tileEl.outerHTML;
}

// ── Primær-bokse i toppen af forsiden (Admin: "Primær-boks 1/2") ────────────
function renderPrimaryTileHTML(it) {
  const target = (it.openMode || "newTab") === "sameTab" ? "_self" : "_blank";
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <a class="primaryTile tileLink"
       href="${esc(it.url)}"
       target="${target}"
       rel="noopener"
       data-track="tile"
       data-title="${esc(it.title || "")}"
       data-url="${esc(it.url || "")}"
       data-category="${esc(it.category || "")}"
       data-group="${esc(it.group || "")}">
      <div class="icon"></div>
      <div class="primaryTitle">${esc(it.title || "")}</div>
    </a>
  `;
  const a = wrapper.firstElementChild;
  setIcon(a.querySelector(".icon"), it.icon);
  return a.outerHTML;
}

// Nyheds-tiles under primær-boksene. Vises indtil videre kun for disse roller –
// tilføj "portal_user" her, når alle skal kunne se dem.
const NEWS_TILE_ROLES = ["portal_admin", "portal_hp_nyheder", "portal_herrup_portal_admin"];

function renderNewsTileHTML(href, icon, title, badgeId) {
  return `
    <a class="primaryTile compact" href="${href}">
      <span class="icon">${icon}</span>
      <span class="primaryTitle">${esc(title)}</span>
      ${badgeId ? `<span class="primaryBadge" id="${badgeId}" hidden></span>` : ""}
    </a>`;
}

// Antal nyheder der venter på godkendelse (kun for redaktører)
async function loadPendingNewsBadge() {
  const badge = document.getElementById("newsPendingBadge");
  if (!badge) return;
  try {
    const r = await fetch("/api/news-admin?count=pending", { cache: "no-store" });
    if (!r.ok) return;
    const { pending } = await r.json();
    if (pending > 0) {
      badge.textContent = String(pending);
      badge.title = `${pending} nyhed${pending === 1 ? "" : "er"} venter på godkendelse`;
      badge.hidden = false;
    }
  } catch { /* ikke kritisk */ }
}

function renderPrimaryBoxes(items, roles = []) {
  const left = document.getElementById("primaryBoxLeft");
  const right = document.getElementById("primaryBoxRight");
  if (!left && !right) return;

  const p1 = items.find(x => x.primaer === 1);
  const p2 = items.find(x => x.primaer === 2);
  const showNews = roles.some(r => NEWS_TILE_ROLES.includes(r));

  if (left) {
    left.innerHTML = `<div class="primaryStack">${p1 ? renderPrimaryTileHTML(p1) : ""}${
      showNews ? renderNewsTileHTML("/nyheder.html", "📰", "Nyheder", "newsPendingBadge") : ""}</div>`;
  }
  if (right) {
    right.innerHTML = `<div class="primaryStack">${p2 ? renderPrimaryTileHTML(p2) : ""}${
      showNews ? renderNewsTileHTML("/nyhed-opret.html", "✍️", "Opret nyhed") : ""}</div>`;
  }
  if (showNews) loadPendingNewsBadge();

  // Samme klik-tracking som de almindelige tiles (no-op når TRACKING_ENABLED er false).
  wireTileTracking(document.querySelector(".hero"));
}

function renderFavGroupHTML(groupName, links, key) {
  const id = `fav_${key}`;
  const label = groupName || "Uden gruppe";
  const count = links.length;
  const noSub = [];
  const bySub = new Map();
  for (const it of (links || [])) {
    const sub = normSubgroup(it);
    if (!sub) { noSub.push(it); } else {
      if (!bySub.has(sub)) bySub.set(sub, []);
      bySub.get(sub).push(it);
    }
  }
  const subEntries = Array.from(bySub.entries()).sort((a, b) => a[0].localeCompare(b[0], "da"));
  const noSubHTML = noSub.length ? `<div class="grid">${sortLinks(noSub).map(renderTileHTML).join("")}</div>` : "";
  const subHTML = subEntries.map(([subName, subLinks]) => {
    if (!subLinks || subLinks.length === 0) return "";
    return `
      <div class="favSubHdr">
        <span class="favSubIcon">📄</span>
        <span class="favSubName">${esc(subName)}</span>
        <span class="favSubCount">${subLinks.length}</span>
      </div>
      <div class="grid">${sortLinks(subLinks).map(renderTileHTML).join("")}</div>
    `;
  }).join("");
  return `
    <div class="favGroup">
      <button class="favGroupHdr" type="button" data-toggle="${id}" aria-expanded="false">
        <span class="favFolder">📁</span>
        <span class="favName">${esc(label)}</span>
        <span class="favCount">${count}</span>
        <span class="favChevron">▾</span>
      </button>
      <div class="favGroupBody" id="${id}" hidden>
        ${noSubHTML}
        ${subHTML}
      </div>
    </div>
  `;
}

function renderCategorySectionHTML(categoryName, links, sectionIndex) {
  const rawCat = categoryName || "Andet";
  const cat = rawCat.toLowerCase() === "static apps" ? "Web Apps" : rawCat;
  const isFav = cat.toLowerCase() === "lely favoritter";
  if (isFav) {
    const byGroup = groupBy(links, x => normKey(x.group) || "Uden gruppe");
    const groups = Array.from(byGroup.entries()).sort((a, b) => a[0].localeCompare(b[0], "da"));
    return `
      <section class="section">
        <div class="accent-bar" style="margin-bottom:10px;">${esc(cat)}</div>
        <div class="sectionBody">
          ${groups.map(([g, ls], i) => renderFavGroupHTML(g, ls, `${sectionIndex}_${i}`)).join("")}
        </div>
      </section>
    `;
  }
  return `
    <section class="section">
      <div class="accent-bar" style="margin-bottom:10px;">${esc(cat)}</div>
      <div class="sectionBody">
        <div class="grid">${sortLinks(links).map(renderTileHTML).join("")}</div>
      </div>
    </section>
  `;
}

// "Mine favoritter" er ikke en rigtig kategori i Dataverse — det er en
// virtuel, brugerspecifik sektion styret af stjernemarkeringen, og den
// vises altid allerførst, uanset hvilke kategorier de stjernemarkerede
// links faktisk hører til.
function renderMyFavoritesSectionHTML(links) {
  const body = links.length
    ? `<div class="grid">${sortLinks(links).map(renderTileHTML).join("")}</div>`
    : `<div class="muted" style="padding:.4rem 0 .2rem">Klik på stjernen ☆ på et link for at samle dine mest brugte her.</div>`;
  return `
    <section class="section" id="mineFavoritterSection">
      <div class="accent-bar" style="margin-bottom:10px;">Mine favoritter</div>
      <div class="sectionBody">${body}</div>
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
  root.querySelectorAll('.tileLink[data-track="tile"]').forEach(a => {
    a.addEventListener("click", () => {
      track("Click", {
        targetUrl: safeUrl(a.getAttribute("data-url") || a.href || ""),
        targetTitle: (a.getAttribute("data-title") || "").substring(0, 200),
        targetCategory: (a.getAttribute("data-category") || "").substring(0, 100),
        targetGroup: (a.getAttribute("data-group") || "").substring(0, 100)
      });
    }, { passive: true });
  });
}

// Stjerne-knapperne sidder inde i selve tile-kortet, men UDEN for det
// klikbare link (se renderTileHTML) — så et klik på stjernen aldrig åbner
// linket, kun skifter favorit-status.
function wireFavoriteStars(root) {
  root.querySelectorAll(".favStar").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFavorite(btn.getAttribute("data-fav-id"));
    });
  });
}

function renderSections(items, myFavItems) {
  const root = document.getElementById("sections");
  if (!root) return;
  const byCat = groupBy(items, x => normKey(x.category) || "Andet");
  const entries = Array.from(byCat.entries()).sort((a, b) => {
    const an = a[0].toLowerCase(), bn = b[0].toLowerCase();
    if (an === "lely favoritter" && bn !== "lely favoritter") return -1;
    if (bn === "lely favoritter" && an !== "lely favoritter") return 1;
    return a[0].localeCompare(b[0], "da");
  });
  const catHTML = entries.map(([cat, links], i) => renderCategorySectionHTML(cat, links, i)).join("");
  const favHTML = renderMyFavoritesSectionHTML(myFavItems || []);
  root.innerHTML = favHTML + catHTML;
  wireAccordions(root);
  wireTileTracking(root);
  wireFavoriteStars(root);
  wireEmployeeSearch(root);
}

(async function init() {
  const userLine = document.getElementById("userLine");
  if (userLine) userLine.textContent = "Henter bruger...";

  let me = null;
  try { me = await getMe(); } catch { me = null; }

  const roles = expandRoles(rolesFromMe(me));
  if (userLine) userLine.textContent = me?.userDetails || "Ikke logget ind";

  const adminLink = document.getElementById("adminLink");
  if (adminLink) adminLink.classList.toggle("hidden", !roles.includes("portal_admin"));

  // Hent brugerens stjernemarkerede favoritter parallelt med links, så
  // "Mine favoritter" er korrekt allerede ved første tegning af siden.
  const favoritesPromise = loadFavorites();

  // Nyhed/tip er ren dekoration i "Velkommen"-teksten — kaldes uafhængigt og
  // blokerer ikke resten af siden, uanset om den lykkes eller ikke.
  loadNewsOrTip();

  let raw = [];
  try {
    raw = await loadLinks();
  } catch (e) {
    console.warn("Kunne ikke hente links:", e);
    await favoritesPromise;
    renderSections([], []);
    return;
  }
  await favoritesPromise;

  const platform = detectPlatform();

  const itemsAll = (raw || [])
    .map(x => ({
      ...x,
      allowedRoles: parseAllowedRoles(x.allowedRoles),
      enabled: x.enabled !== false,
      platformHint: (x.platformHint || "all").toLowerCase(),
      subgroup: normSubgroup(x)
    }))
    .filter(x => x.enabled)
    .filter(x => x.platformHint === "all" || x.platformHint === platform)
    .filter(x => matchesRoles(x.allowedRoles, roles))
    .sort((a, b) => (a.sort ?? 1000) - (b.sort ?? 1000));

  const categories = uniq(itemsAll.map(x => x.category));
  const groups = uniq(itemsAll.map(x => x.group).filter(Boolean));

  // De 2 "primære app"-bokse i toppen af siden — uafhængige af søgning/
  // kategori-filter, sættes én gang her.
  renderPrimaryBoxes(itemsAll, roles);

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
    const matchesSearch = (x) => !qq
      || (x.title || "").toLowerCase().includes(qq)
      || (x.url || "").toLowerCase().includes(qq);

    const filtered = itemsAll.filter(x => {
      if (cat && (x.category || "") !== cat) return false;
      if (grp && (x.group || "") !== grp) return false;
      return matchesSearch(x);
    });

    // "Mine favoritter" er brugerens egen samling og ignorerer derfor
    // kategori/gruppe-filtrene (ellers kunne man "filtrere favoritterne
    // væk" ved et uheld) — men respekterer stadig søgefeltet.
    const myFav = itemsAll.filter(x => favoriteIds.has(x.id) && matchesSearch(x));

    renderSections(filtered, myFav);
  }

  rerenderMain = render;

  if (q) q.addEventListener("input", () => { syncClearBtn(); render(); });
  if (qx) qx.addEventListener("click", () => { q.value = ""; syncClearBtn(); render(); });
  if (catSel) catSel.addEventListener("change", render);
  if (grpSel) grpSel.addEventListener("change", render);

  syncClearBtn();
  render();
})();






