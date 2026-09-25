// assets/nyheder-admin.js – opret og ret nyheder (nyheder-admin.html)
(function () {
  "use strict";
  const { esc, fmtDate, TYPE_LABEL, parseVideo, userLine } = window.NewsCommon;
  const $ = id => document.getElementById(id);

  const MAX_IMG_SIDE = 1600;
  const DEFAULT_COLOR = "#FFD400";

  let items = [];
  let currentId = null;
  let dirty = false;
  let quill = null;

  // ── API ───────────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const r = await fetch(path, {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok) throw Object.assign(new Error(data?.error || `HTTP ${r.status}`), { status: r.status });
    return data;
  }

  function msg(text, kind = "") {
    $("msg").textContent = text || "";
    $("msg").className = "naMsg " + kind;
  }

  // ── Billeder: formindsk i browseren og upload ─────────────────────────────
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Billedet kunne ikke læses"));
      img.src = src;
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // Returnerer { mime, data(base64) }. GIF bevares (animation).
  async function prepareImage(blob) {
    if (blob.type === "image/gif" && blob.size < 5 * 1024 * 1024) {
      return { mime: "image/gif", data: await blobToBase64(blob) };
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      const scale = Math.min(1, MAX_IMG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";          // gennemsigtige PNG'er får hvid baggrund
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const out = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.85));
      return { mime: "image/jpeg", data: await blobToBase64(out) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadImage(blob, name) {
    const p = await prepareImage(blob);
    const r = await api("POST", "/api/news-image", { name: name || "billede", mime: p.mime, data: p.data });
    return r.url;
  }

  async function dataUrlToBlob(dataUrl) {
    const r = await fetch(dataUrl);
    return r.blob();
  }

  // Indsæt billeder fra filvælger, træk-og-slip eller indsæt
  async function insertFiles(range, files) {
    let index = range ? range.index : quill.getLength();
    for (const file of files) {
      if (!/^image\//.test(file.type)) continue;
      msg(`Uploader ${file.name || "billede"}…`);
      try {
        const url = await uploadImage(file, file.name);
        quill.insertEmbed(index, "image", url, "user");
        index += 1;
        quill.setSelection(index, 0, "silent");
        msg("");
      } catch (e) {
        msg(`Billedet kunne ikke uploades: ${e.message}`, "err");
      }
    }
  }

  function pickImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => insertFiles(quill.getSelection(true), [...input.files]);
    input.click();
  }

  // Billeder indsat som data-URL (fx kopieret fra Teams/Word) uploades ved gem
  async function uploadInlineImages(html) {
    const matches = [...html.matchAll(/<img[^>]+src="(data:image\/[^"]+)"/gi)];
    let out = html, n = 0;
    for (const m of matches) {
      n++;
      msg(`Uploader billede ${n} af ${matches.length}…`);
      const url = await uploadImage(await dataUrlToBlob(m[1]), `billede-${n}`);
      out = out.replace(m[1], url);
    }
    return out;
  }

  function editorHTML() {
    let html = quill.getSemanticHTML();
    // Quill 2 laver mellemrum om til &nbsp; – det forhindrer linjeskift
    html = html.replace(/&nbsp;/g, " ");
    const text = quill.getText().trim();
    if (!text && !/<img/i.test(html)) return "";
    return html;
  }

  function setEditorHTML(html) {
    quill.setContents(quill.clipboard.convert({ html: html || "" }), "silent");
    quill.history.clear();
  }

  // ── Formular ──────────────────────────────────────────────────────────────
  function selectedType() {
    return document.querySelector('input[name="type"]:checked')?.value || "nyhed";
  }

  function toLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function currentBanner() {
    return {
      tekst: $("bannertekst").value.trim(),
      farve: $("bannercolor").value.toUpperCase(),
      tile: $("bannerTile").checked,
      navbar: $("bannerNavbar").checked,
      slut: $("bannerSlut").value ? new Date($("bannerSlut").value).toISOString() : null,
      visning: document.querySelector('input[name="bannerVisning"]:checked')?.value || "alle"
    };
  }

  function updateBannerUI() {
    const b = currentBanner();
    document.querySelectorAll(".naSwatch").forEach(s => s.classList.toggle("active", s.dataset.color.toUpperCase() === b.farve));
    const off = !b.tekst;
    $("bannerTile").disabled = off;
    $("bannerNavbar").disabled = off;
    document.querySelectorAll('input[name="bannerVisning"]').forEach(r => { r.disabled = off; });
    window.HerrupTicker?.preview($("bannerPreview"), b.tekst ? {
      ...b,
      overskrift: $("overskrift").value.trim() || "Overskrift",
      indhold: $("indhold").value.trim() || "Kort besked",
      hasBody: false
    } : null);
  }

  function updateCounter() {
    const n = $("indhold").value.length;
    $("indholdCount").textContent = `${n} / 300`;
    $("indholdCount").classList.toggle("over", n > 300);
  }

  function updateTypeUI() {
    $("udlobRow").style.display = selectedType() === "tip" ? "none" : "";
  }

  function updateVideoPreview() {
    const v = parseVideo($("videourl").value);
    const box = $("videoPreview");
    if (!$("videourl").value.trim()) { box.innerHTML = ""; return; }
    if (!v) { box.innerHTML = `<div class="naMsg err">Linket kan ikke bruges – indsæt integreringskoden fra Stream.</div>`; return; }
    box.innerHTML = v.embed
      ? `<div class="newsVideoFrame"><iframe src="${esc(v.embed)}" allow="autoplay; fullscreen" allowfullscreen title="Video"></iframe></div>`
      : `<div class="muted" style="font-size:.85rem">Vises som en “Afspil video”-knap. Brug integreringskoden fra Stream (Del → Integrer) for at vise videoen direkte på siden.</div>`;
  }

  function fillForm(it) {
    currentId = it?.id || null;
    const type = it?.type || "nyhed";
    document.querySelectorAll('input[name="type"]').forEach(r => { r.checked = r.value === type; });
    $("overskrift").value = it?.overskrift || "";
    $("indhold").value = it?.indhold || "";
    setEditorHTML(it?.brodtekst || "");
    $("videourl").value = it?.videourl || "";
    $("aktiv").checked = it ? it.aktiv !== false : true;
    $("udlobsdato").value = it?.udlobsdato || "";
    $("bannertekst").value = it?.banner?.tekst || "";
    $("bannercolor").value = /^#[0-9a-f]{6}$/i.test(it?.banner?.farve || "") ? it.banner.farve : DEFAULT_COLOR;
    $("bannerTile").checked = !!it?.banner?.tile;
    $("bannerNavbar").checked = !!it?.banner?.navbar;
    $("bannerSlut").value = toLocalInput(it?.banner?.slut);
    const vis = it?.banner?.visning || "alle";
    document.querySelectorAll('input[name="bannerVisning"]').forEach(r => { r.checked = r.value === vis; });
    $("resetSeenBtn").hidden = !currentId;

    $("deleteBtn").hidden = !currentId;
    $("viewBtn").hidden = !currentId;
    if (currentId) $("viewBtn").href = `/nyhed.html?id=${encodeURIComponent(currentId)}`;

    const u = new URL(location.href);
    if (currentId) u.searchParams.set("id", currentId); else u.searchParams.delete("id");
    history.replaceState(null, "", u);

    updateCounter(); updateTypeUI(); updateBannerUI(); updateVideoPreview();
    renderList();
    dirty = false;
    msg("");
  }

  function confirmDiscard() {
    return !dirty || confirm("Du har ændringer, der ikke er gemt. Vil du fortsætte?");
  }

  // ── Liste ─────────────────────────────────────────────────────────────────
  function renderList() {
    const q = $("listQ").value.trim().toLowerCase();
    $("listQx").style.visibility = q ? "visible" : "hidden";
    const list = items.filter(it => !q || (it.overskrift + " " + it.indhold).toLowerCase().includes(q));
    if (!list.length) {
      $("items").innerHTML = `<div class="muted" style="padding:.5rem">${items.length ? "Ingen match" : "Ingen nyheder endnu"}</div>`;
      return;
    }
    $("items").innerHTML = list.map(it => `
      <button type="button" class="naItem${it.id === currentId ? " selected" : ""}${it.aktiv ? "" : " inactive"}" data-id="${esc(it.id)}">
        <span class="naItemTitle">${esc(it.overskrift || it.indhold || "Uden overskrift")}</span>
        <span class="naItemMeta">
          <span class="newsTypeBadge ${esc(it.type)}">${esc(TYPE_LABEL[it.type] || "Nyhed")}</span>
          <span>${esc(fmtDate(it.createdon))}</span>
          ${it.aktiv ? "" : "<span>· Inaktiv</span>"}
          ${it.banner?.active ? `<span class="naBannerDot">${esc(it.banner.tekst)}${it.banner.visning === "test" ? " · TEST" : (it.banner.visning === "mig" ? " · KUN MIG" : "")}</span>` : ""}
          ${it.videourl ? "<span>🎬</span>" : ""}
        </span>
      </button>`).join("");
    $("items").querySelectorAll(".naItem").forEach(b => b.addEventListener("click", () => openItem(b.dataset.id)));
  }

  async function loadList() {
    const data = await api("GET", "/api/news-admin");
    items = data.items || [];
    renderList();
  }

  async function openItem(id) {
    if (id === currentId || !confirmDiscard()) return;
    msg("Henter…");
    try {
      const data = await api("GET", `/api/news-admin/${encodeURIComponent(id)}`);
      fillForm(data.item);
    } catch (e) {
      msg(`Kunne ikke hente: ${e.message}`, "err");
    }
  }

  // ── Gem / slet ────────────────────────────────────────────────────────────
  async function save() {
    const overskrift = $("overskrift").value.trim();
    const indhold = $("indhold").value.trim();
    if (!overskrift) { msg("Skriv en overskrift", "err"); $("overskrift").focus(); return; }
    if (!indhold) { msg("Skriv en kort besked", "err"); $("indhold").focus(); return; }

    const btn = $("saveBtn");
    btn.disabled = true;
    try {
      let brodtekst = editorHTML();
      if (/src="data:image\//i.test(brodtekst)) {
        brodtekst = await uploadInlineImages(brodtekst);
        setEditorHTML(brodtekst);
      }

      const v = $("videourl").value.trim();
      const parsed = parseVideo(v);
      const payload = {
        type: selectedType(),
        overskrift,
        indhold,
        brodtekst,
        videourl: parsed ? (parsed.embed || parsed.link) : "",
        aktiv: $("aktiv").checked,
        udlobsdato: selectedType() === "tip" ? null : ($("udlobsdato").value || null),
        banner: currentBanner()
      };
      if (v && !parsed) throw new Error("Videolinket kan ikke bruges");

      msg("Gemmer…");
      const r = await api(currentId ? "PUT" : "POST", currentId ? `/api/news-admin/${currentId}` : "/api/news-admin", payload);
      dirty = false;
      await loadList();
      const saved = r.id ? items.find(x => x.id === r.id) : null;
      if (r.id && r.id !== currentId) {
        currentId = null;
        const data = await api("GET", `/api/news-admin/${encodeURIComponent(r.id)}`);
        fillForm(data.item);
      } else if (saved) {
        renderList();
      }
      msg(r.imageWarning ? `Gemt – men: ${r.imageWarning}` : "Gemt ✓", r.imageWarning ? "err" : "ok");
    } catch (e) {
      msg(`Kunne ikke gemme: ${e.message}`, "err");
    } finally {
      btn.disabled = false;
    }
  }

  async function remove() {
    if (!currentId) return;
    if (!confirm("Slet nyheden og dens billeder? Det kan ikke fortrydes.")) return;
    try {
      await api("DELETE", `/api/news-admin/${currentId}`);
      dirty = false;
      await loadList();
      fillForm(null);
      msg("Slettet", "ok");
    } catch (e) {
      msg(`Kunne ikke slette: ${e.message}`, "err");
    }
  }

  // ── Opstart ───────────────────────────────────────────────────────────────
  async function init() {
    userLine();
    window.HerrupTicker?.load();

    try {
      await loadList();
    } catch (e) {
      if (e.status === 401 || e.status === 403) { $("noAccess").hidden = false; return; }
      $("noAccess").hidden = false;
      $("noAccess").innerHTML = `<div>Kunne ikke hente nyheder: ${esc(e.message)}</div>`;
      return;
    }
    $("app").hidden = false;

    quill = new Quill("#editor", {
      theme: "snow",
      placeholder: "Skriv eller indsæt teksten her…",
      modules: {
        toolbar: {
          container: [
            [{ header: [2, 3, false] }],
            ["bold", "italic", "underline"],
            [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
            [{ align: [] }],
            ["blockquote", "link", "image"],
            ["clean"]
          ],
          handlers: { image: pickImage }
        },
        uploader: { handler: (range, files) => insertFiles(range, files) }
      }
    });
    quill.on("text-change", (d, o, source) => { if (source === "user") dirty = true; });

    ["overskrift", "indhold", "videourl", "udlobsdato", "bannertekst", "bannerSlut"].forEach(id =>
      $(id).addEventListener("input", () => { dirty = true; }));
    ["aktiv", "bannerTile", "bannerNavbar", "bannercolor"].forEach(id =>
      $(id).addEventListener("change", () => { dirty = true; }));
    document.querySelectorAll('input[name="bannerVisning"]').forEach(r => r.addEventListener("change", () => { dirty = true; }));

    $("resetSeenBtn").addEventListener("click", () => {
      if (!currentId) return;
      window.HerrupTicker?.resetSeen(currentId);
      msg("Bjælken vises igen for dig (hvis den er aktiv)", "ok");
    });

    // Vejledning til video
    const openHelp = e => { e?.preventDefault(); $("videoHelp").hidden = false; $("videoHelpOk").focus(); };
    const closeHelp = () => { $("videoHelp").hidden = true; };
    $("videoHelpLink").addEventListener("click", openHelp);
    $("videoHelpClose").addEventListener("click", closeHelp);
    $("videoHelpOk").addEventListener("click", closeHelp);
    $("videoHelp").addEventListener("click", e => { if (e.target === $("videoHelp")) closeHelp(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("videoHelp").hidden) closeHelp(); });

    $("indhold").addEventListener("input", () => { updateCounter(); updateBannerUI(); });
    $("overskrift").addEventListener("input", updateBannerUI);
    $("bannertekst").addEventListener("input", updateBannerUI);
    $("bannercolor").addEventListener("input", updateBannerUI);
    $("videourl").addEventListener("input", updateVideoPreview);
    document.querySelectorAll('input[name="type"]').forEach(r => r.addEventListener("change", () => { dirty = true; updateTypeUI(); }));
    document.querySelectorAll(".naPreset").forEach(b => b.addEventListener("click", () => {
      $("bannertekst").value = b.dataset.text; dirty = true; updateBannerUI();
    }));
    document.querySelectorAll(".naSwatch").forEach(s => s.addEventListener("click", () => {
      $("bannercolor").value = s.dataset.color; dirty = true; updateBannerUI();
    }));

    $("listQ").addEventListener("input", renderList);
    $("listQx").addEventListener("click", () => { $("listQ").value = ""; renderList(); });
    $("newBtn").addEventListener("click", () => { if (confirmDiscard()) fillForm(null); });
    $("saveBtn").addEventListener("click", save);
    $("deleteBtn").addEventListener("click", remove);
    window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
    document.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
    });

    const startId = new URLSearchParams(location.search).get("id");
    if (startId) {
      try {
        const data = await api("GET", `/api/news-admin/${encodeURIComponent(startId)}`);
        fillForm(data.item);
      } catch (e) {
        fillForm(null);
        msg(`Kunne ikke hente nyheden: ${e.message}`, "err");
      }
    } else {
      fillForm(null);
    }
  }

  init();
})();
