// assets/nyhed-opret.js – medarbejdere indsender en nyhed til godkendelse
(function () {
  "use strict";
  const { userLine } = window.NewsCommon;
  const $ = id => document.getElementById(id);
  let editor = null;
  let dirty = false;

  function msg(text, kind = "") {
    $("msg").textContent = text || "";
    $("msg").className = "naMsg " + kind;
  }

  function counter() {
    const n = $("indhold").value.length;
    $("indholdCount").textContent = `${n} / 300`;
    $("indholdCount").classList.toggle("over", n > 300);
  }

  let videoField = null;
  const updateVideoPreview = () => videoField?.refresh();

  async function send() {
    const overskrift = $("overskrift").value.trim();
    const indhold = $("indhold").value.trim();
    if (!overskrift) { msg("Skriv en overskrift", "err"); $("overskrift").focus(); return; }
    if (!indhold) { msg("Skriv en kort besked", "err"); $("indhold").focus(); return; }

    const rawVideo = $("videourl").value.trim();

    $("sendBtn").disabled = true;
    try {
      const brodtekst = await editor.getHTMLWithUploads();
      msg("Sender…");
      const r = await fetch("/api/news-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overskrift, indhold, brodtekst, videourl: rawVideo })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      dirty = false;
      $("formPanel").hidden = true;
      $("donePanel").hidden = false;
    } catch (e) {
      msg(`Kunne ikke sende: ${e.message}`, "err");
    } finally {
      $("sendBtn").disabled = false;
    }
  }

  function reset() {
    $("overskrift").value = "";
    $("indhold").value = "";
    $("videourl").value = "";
    updateVideoPreview();
    editor.setHTML("");
    counter();
    msg("");
    dirty = false;
    $("donePanel").hidden = true;
    $("formPanel").hidden = false;
    $("overskrift").focus();
  }

  function init() {
    userLine();
    window.HerrupTicker?.load();
    editor = NewsEditor.create("#editor", { onMessage: msg, onChange: () => { dirty = true; } });
    $("overskrift").addEventListener("input", () => { dirty = true; });
    $("indhold").addEventListener("input", () => { dirty = true; counter(); });
    videoField = NewsCommon.wireVideoField({ input: $("videourl"), preview: $("videoPreview"), onChange: () => { dirty = true; } });
    $("videoHelpLink").addEventListener("click", NewsCommon.openVideoHelp);
    NewsCommon.wireAiSummary({
      button: $("aiBtn"),
      textarea: $("indhold"),
      getText: () => editor.quill.getText(),
      getTitle: () => $("overskrift").value,
      onMessage: msg
    });
    $("sendBtn").addEventListener("click", send);
    $("againBtn").addEventListener("click", reset);
    window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
    counter();
  }

  init();
})();
