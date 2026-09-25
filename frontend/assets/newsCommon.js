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

  // ── Vejledning: video fra pc til Stream (popup) ──────────────────────────
  const VIDEO_HELP_HTML = `<div id="videoHelp" class="naOverlay" hidden>
  <div class="naModal" role="dialog" aria-modal="true" aria-labelledby="videoHelpTitle">
    <div class="naModalHeader">
      <div class="naModalTitle" id="videoHelpTitle">🎬 Sådan får du en video ind i nyheden</div>
      <button type="button" class="naCloseBtn" id="videoHelpClose" aria-label="Luk">✕</button>
    </div>
    <ol class="naSteps">
      <li>
        <strong>Upload videoen til OneDrive</strong>
        Åbn <a href="https://www.office.com/launch/onedrive" target="_blank" rel="noopener">OneDrive</a> i browseren, klik <em>Tilføj nyt → Upload af filer</em>, og vælg videoen på din pc.
        <div class="naStepTip">En Teams-optagelse ligger allerede i OneDrive under mappen <em>Optagelser</em> – så kan du springe dette trin over.</div>
      </li>
      <li>
        <strong>Åbn videoen</strong>
        Klik på videoen i OneDrive. Den åbner i Stream.
      </li>
      <li>
        <strong>Klip starten og slutningen (valgfrit)</strong>
        I Stream kan du trimme videoen, så ventetiden før og efter mødet forsvinder. Du kan også klippe den i Clipchamp, før du uploader.
      </li>
      <li>
        <strong>Del med alle i firmaet og kopiér linket</strong>
        Klik <em>Del</em>, vælg at <em>Personer i Lely Center Herrup</em> kan se videoen, og klik <em>Kopiér link</em>.
        <div class="naStepTip">Uden “Personer i Lely Center Herrup” kan kollegerne ikke afspille videoen i portalen.</div>
      </li>
      <li>
        <strong>Indsæt linket her</strong>
        Sæt linket ind i Video-feltet. Portalen finder selv videoen og viser en forhåndsvisning under feltet. Når nyheden gemmes, kommer videoen i sin egen tile ved siden af nyheden.
      </li>
    </ol>
    <div class="naStepTip" style="margin-top:12px">
      Videoen ligger i <strong>din</strong> OneDrive. Slettes din konto, forsvinder videoen også – så gem den gerne et fælles sted, hvis den skal bevares.
    </div>
    <div class="naActions" style="border-top:0;padding-top:0">
      <span class="spacer"></span>
      <button type="button" class="btn primary" id="videoHelpOk">Forstået</button>
    </div>
  </div>
</div>
`;

  function openVideoHelp(e) {
    e?.preventDefault?.();
    let el = document.getElementById("videoHelp");
    if (!el) {
      document.body.insertAdjacentHTML("beforeend", VIDEO_HELP_HTML);
      el = document.getElementById("videoHelp");
      const close = () => { el.hidden = true; };
      el.querySelector("#videoHelpClose").addEventListener("click", close);
      el.querySelector("#videoHelpOk").addEventListener("click", close);
      el.addEventListener("click", ev => { if (ev.target === el) close(); });
      document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !el.hidden) close(); });
    }
    el.hidden = false;
    el.querySelector("#videoHelpOk").focus();
  }

  // ── "Send tekst til AI": kort oversigt til feltet Kort besked ───────────
  // opts: { button, textarea, getText(), getTitle(), onMessage(text, kind), maxLen, onDone() }
  function wireAiSummary(opts) {
    const btn = opts.button;
    const maxLen = opts.maxLen || 300;
    btn.addEventListener("click", async () => {
      const text = String(opts.getText() || "").trim();
      if (text.length < 40) { opts.onMessage?.("Skriv eller indsæt først “Hele teksten”", "err"); return; }
      const current = opts.textarea.value.trim();
      const room = Math.max(80, maxLen - current.length - 1);
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "AI arbejder…";
      opts.onMessage?.("");
      try {
        const r = await fetch("/api/news-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, overskrift: opts.getTitle?.() || "", maxChars: room })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        opts.textarea.value = current ? `${current}\n${data.summary}` : data.summary;
        opts.textarea.dispatchEvent(new Event("input", { bubbles: true }));
        opts.onMessage?.("AI-oversigten er sat ind i Kort besked – ret den gerne til", "ok");
        opts.onDone?.();
      } catch (e) {
        opts.onMessage?.(`AI kunne ikke lave en oversigt: ${e.message}`, "err");
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  }

  // ── Video-felt: indsæt OneDrive-link → forhåndsvisning ───────────────────
  // opts: { input, preview, onChange }
  function wireVideoField(opts) {
    const { input, preview } = opts;
    let timer = null, seq = 0;

    function frame(url) {
      return `<div class="newsVideoFrame"><iframe src="${esc(url)}" allow="autoplay; fullscreen" allowfullscreen title="Video"></iframe></div>`;
    }

    async function refresh() {
      const raw = input.value.trim();
      const my = ++seq;
      if (!raw) { preview.innerHTML = ""; return; }
      const direct = parseVideo(raw);
      if (direct?.embed) { preview.innerHTML = frame(direct.embed); return; }
      preview.innerHTML = `<div class="muted" style="font-size:.85rem">Finder videoen…</div>`;
      try {
        const r = await fetch("/api/news-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: raw })
        });
        const data = await r.json().catch(() => ({}));
        if (my !== seq) return;
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        preview.innerHTML = frame(data.embed) + (data.name ? `<div class="muted" style="font-size:.8rem;margin-top:4px">🎬 ${esc(data.name)}</div>` : "");
      } catch (e) {
        if (my !== seq) return;
        preview.innerHTML = `<div class="naMsg err">${esc(e.message)}</div>`;
      }
    }

    input.addEventListener("input", () => {
      opts.onChange?.();
      clearTimeout(timer);
      timer = setTimeout(refresh, 500);
    });
    return { refresh };
  }

  window.NewsCommon = { TYPE_LABEL, esc, fmtDate, typeBadge, getMe, isEditor, parseVideo, userLine, openVideoHelp, wireAiSummary, wireVideoField };
})();
