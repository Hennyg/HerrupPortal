// assets/nyheder.js – nyhedsoversigt (nyheder.html)
(function () {
  "use strict";
  const { esc, fmtDate, typeBadge, isEditor, userLine } = window.NewsCommon;
  const $ = id => document.getElementById(id);

  let all = [];
  let type = new URLSearchParams(location.search).get("type") || "";

  function render() {
    const q = $("q").value.trim().toLowerCase();
    $("qx").style.visibility = q ? "visible" : "hidden";
    document.querySelectorAll(".newsChip").forEach(b => b.classList.toggle("active", b.dataset.type === type));

    const list = all.filter(it =>
      (!type || it.type === type) &&
      (!q || (it.overskrift + " " + it.indhold).toLowerCase().includes(q))
    );

    if (!list.length) {
      $("grid").innerHTML = `<div class="newsEmpty">${all.length ? "Ingen nyheder matcher" : "Der er ingen nyheder endnu"}</div>`;
      return;
    }

    $("grid").innerHTML = list.map((it, i) => `
      <a class="newsCard${i === 0 && !q ? " featured" : ""}" href="/nyhed.html?id=${encodeURIComponent(it.id)}">
        <div class="newsMeta">${typeBadge(it.type)}<span>${esc(fmtDate(it.createdon))}</span>${it.banner?.active ? `<span class="naBannerDot">${esc(it.banner.tekst)}</span>` : ""}</div>
        <h3>${esc(it.overskrift || "Uden overskrift")}</h3>
        <div class="newsCardText">${esc(it.indhold)}</div>
        <div class="newsCardFoot">
          <span>${it.videourl ? "🎬 Video" : ""}</span>
          <span class="more">${it.hasBody || it.videourl ? "Læs mere →" : ""}</span>
        </div>
      </a>`).join("");
  }

  async function init() {
    userLine();
    window.HerrupTicker?.load();
    if (await isEditor()) {
      $("newBtn").hidden = false;
      // Vis om der er indsendte nyheder, der venter på godkendelse
      fetch("/api/news-admin?count=pending", { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d?.pending) return;
          const el = $("pendingBar");
          el.innerHTML = `⏳ ${d.pending} nyhed${d.pending === 1 ? "" : "er"} venter på godkendelse – <a href="/nyheder-admin.html?filter=afventer">gå til godkendelse</a>`;
          el.hidden = false;
        })
        .catch(() => {});
    }

    document.querySelectorAll(".newsChip").forEach(b => b.addEventListener("click", () => {
      type = b.dataset.type;
      const u = new URL(location.href);
      if (type) u.searchParams.set("type", type); else u.searchParams.delete("type");
      history.replaceState(null, "", u);
      render();
    }));
    $("q").addEventListener("input", render);
    $("qx").addEventListener("click", () => { $("q").value = ""; render(); });

    try {
      const r = await fetch("/api/news", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      all = data.items || [];
      render();
    } catch (e) {
      $("grid").innerHTML = `<div class="newsEmpty">Kunne ikke hente nyheder: ${esc(e.message)}</div>`;
    }
  }

  init();
})();
