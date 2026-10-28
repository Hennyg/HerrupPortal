// assets/nyhed.js – én nyhed (nyhed.html?id=…)
(function () {
  "use strict";
  const { esc, fmtDate, typeBadge, isEditor, parseVideo, userLine } = window.NewsCommon;
  const $ = id => document.getElementById(id);

  function showError(msg) {
    $("notFound").hidden = false;
    $("notFound").textContent = msg;
  }

  // Installeret som app (PWA) eller iPhone/iPad: SharePoint-iframes kan ikke
  // logge ind dér (egen cookie-lagring + blokerede tredjeparts-cookies),
  // så videoen åbnes i stedet som en almindelig side.
  function iframeUnsafe() {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.matchMedia?.("(display-mode: fullscreen)").matches ||
      window.matchMedia?.("(display-mode: minimal-ui)").matches ||
      window.navigator.standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return standalone || ios;
  }

  function playButton(href) {
    return `<a class="btn primary" href="${esc(href)}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block">▶ Afspil video</a>`;
  }

  function renderVideo(url) {
    const v = parseVideo(url);
    if (!v) return false;
    if (v.embed && !iframeUnsafe()) {
      $("videoBox").innerHTML = `
        <div class="newsVideoFrame">
          <iframe src="${esc(v.embed)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy" title="Video"></iframe>
        </div>
        <div class="newsVideoHint">Afspilles ikke videoen? <a href="${esc(v.embed)}" target="_blank" rel="noopener">Åbn i nyt vindue</a></div>`;
    } else {
      $("videoBox").innerHTML = playButton(v.embed || v.link);
    }
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
