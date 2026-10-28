// assets/nyhed.js – én nyhed (nyhed.html?id=…)
(function () {
  "use strict";
  const { esc, fmtDate, typeBadge, isEditor, parseVideo, userLine } = window.NewsCommon;
  const $ = id => document.getElementById(id);

  function showError(msg) {
    $("notFound").hidden = false;
    $("notFound").textContent = msg;
  }

  // SharePoint/OneDrive-video vises IKKE i iframe: uden en SharePoint-session
  // i browseren sendes iframen til Microsoft-login, som ikke må vises i en
  // iframe (blocked). I stedet åbnes videoen i nyt vindue, hvor login virker.
  function renderVideo(url) {
    const v = parseVideo(url);
    if (!v) return false;
    const href = v.embed || v.link;
    $("videoBox").innerHTML = `
      <a href="${esc(href)}" target="_blank" rel="noopener" title="Afspil video"
         style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
                aspect-ratio:16/9;width:100%;border-radius:10px;background:#1f2937;color:#fff;
                text-decoration:none;cursor:pointer">
        <span style="display:flex;align-items:center;justify-content:center;width:72px;height:72px;
                     border-radius:50%;background:#c30a14;font-size:30px;padding-left:6px;box-sizing:border-box">▶</span>
        <span style="font-weight:600">Afspil video</span>
      </a>
      <div class="newsVideoHint">Videoen åbner i et nyt vindue.</div>`;
    return true;
  }

  // Logger at brugeren har åbnet nyheden (vises i statistik.html).
  // Brugeren bestemmes server-side ud fra login - kun én gang pr. sidevisning.
  function trackNewsView(it) {
    try {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "NewsView",
          pageUrl: location.origin + location.pathname + location.search,
          path: location.pathname,
          referrer: document.referrer || "",
          targetTitle: it.overskrift || "",
          targetUrl: `/nyhed.html?id=${it.id}`,
          targetCategory: it.type || ""
        }),
        keepalive: true
      }).catch(() => {});
    } catch { /* logning må aldrig forstyrre siden */ }
  }

  async function init() {
    userLine();

    const id = new URLSearchParams(location.search).get("id");
    if (!id) { window.HerrupTicker?.load(); return showError("Der er ikke valgt en nyhed."); }

    let it;
    try {
      const r = await fetch(`/api/news/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      it = data.item;
    } catch (e) {
      window.HerrupTicker?.load();
      return showError(`Kunne ikke hente nyheden: ${e.message}`);
    }

    // Brugeren har nu set nyheden → dens bjælke stopper for brugeren
    window.HerrupTicker?.markSeen(it.id, it.modifiedon);
    trackNewsView(it);
    window.HerrupTicker?.load();

    document.title = `${it.overskrift || "Nyhed"} – Herrup Portalen`;
    $("meta").innerHTML = `${typeBadge(it.type)}<span>${esc(fmtDate(it.createdon))}</span>` +
      (it.modifiedon && Math.abs(new Date(it.modifiedon) - new Date(it.createdon)) > 3600000
        ? `<span>Opdateret ${esc(fmtDate(it.modifiedon))}</span>` : "");
    $("title").textContent = it.overskrift || "Nyhed";
    $("lead").textContent = it.indhold || "";

    const html = it.brodtekst || "";
    const clean = window.DOMPurify
      ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "iframe", "form"], ADD_ATTR: ["target"] })
      : "";
    $("body").innerHTML = clean;
    $("body").querySelectorAll("a[href]").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
    if (!clean.replace(/<[^>]*>/g, "").trim() && !/<img/i.test(clean)) $("lead").style.borderBottom = "0";

    const hasVideo = renderVideo(it.videourl);
    $("videoTile").hidden = !hasVideo;
    $("layout").classList.toggle("hasVideo", hasVideo);
    $("layout").hidden = false;

    if (await isEditor()) {
      $("editBtn").href = `/nyheder-admin.html?id=${encodeURIComponent(it.id)}`;
      $("editBar").hidden = false;
    }
  }

  init();
})();
