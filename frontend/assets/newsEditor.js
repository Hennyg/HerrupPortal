// assets/newsEditor.js – fælles tekst-editor (Quill) med billed-upload.
// Bruges af nyheder-admin.html og nyhed-opret.html.
(function () {
  "use strict";

  const MAX_IMG_SIDE = 1600;

  async function postJson(path, body) {
    const r = await fetch(path, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  }

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

  // Formindsker til maks 1600 px og JPEG. GIF bevares (animation).
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
      ctx.fillStyle = "#fff";
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
    const r = await postJson("/api/news-image", { name: name || "billede", mime: p.mime, data: p.data });
    return r.url;
  }

  // create(selector, { placeholder, onMessage(text, kind), onChange() })
  function create(selector, opts = {}) {
    const say = opts.onMessage || (() => {});
    let quill = null;

    async function insertFiles(range, files) {
      let index = range ? range.index : quill.getLength();
      for (const file of files) {
        if (!/^image\//.test(file.type)) continue;
        say(`Uploader ${file.name || "billede"}…`);
        try {
          const url = await uploadImage(file, file.name);
          quill.insertEmbed(index, "image", url, "user");
          index += 1;
          quill.setSelection(index, 0, "silent");
          say("");
        } catch (e) {
          say(`Billedet kunne ikke uploades: ${e.message}`, "err");
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

    quill = new Quill(selector, {
      theme: "snow",
      placeholder: opts.placeholder || "Skriv eller indsæt teksten her…",
      modules: {
        toolbar: {
          container: opts.toolbar || [
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
    if (opts.onChange) quill.on("text-change", (d, o, source) => { if (source === "user") opts.onChange(); });

    function getHTML() {
      // Quill 2 laver mellemrum om til &nbsp; – det forhindrer linjeskift
      const html = quill.getSemanticHTML().replace(/&nbsp;/g, " ");
      if (!quill.getText().trim() && !/<img/i.test(html)) return "";
      return html;
    }

    function setHTML(html) {
      quill.setContents(quill.clipboard.convert({ html: html || "" }), "silent");
      quill.history.clear();
    }

    // Billeder indsat som data-URL (fx kopieret fra Teams/Word) uploades her
    async function getHTMLWithUploads() {
      let html = getHTML();
      const matches = [...html.matchAll(/<img[^>]+src="(data:image\/[^"]+)"/gi)];
      if (!matches.length) return html;
      let n = 0;
      for (const m of matches) {
        n++;
        say(`Uploader billede ${n} af ${matches.length}…`);
        const blob = await (await fetch(m[1])).blob();
        html = html.replace(m[1], await uploadImage(blob, `billede-${n}`));
      }
      setHTML(html);
      return html;
    }

    return { quill, getHTML, setHTML, getHTMLWithUploads };
  }

  window.NewsEditor = { create };
})();
