(() => {
  const task = document.getElementById("aiTask");
  const taskWrap = document.getElementById("aiTaskWrap");
  const taskOptionsEl = document.getElementById("aiTaskOptions");
  const prompt = document.getElementById("aiPrompt");
  const promptLabel = document.getElementById("aiPromptLabel");
  const imageInput = document.getElementById("aiImages");
  const imagePreview = document.getElementById("aiImagePreview");
  const sendBtn = document.getElementById("aiSend");
  const clearBtn = document.getElementById("aiClear");
  const newConversationBtn = document.getElementById("aiNewConversation");
  const savePdfBtn = document.getElementById("aiSavePdf");
  const bottomActions = document.getElementById("aiBottomActions");
  const newConversationBottomBtn = document.getElementById("aiNewConversationBottom");
  const savePdfBottomBtn = document.getElementById("aiSavePdfBottom");
  const status = document.getElementById("aiStatus");
  const conversationEl = document.getElementById("aiConversation");
  const composerTitle = document.getElementById("aiComposerTitle");
  const hint = document.getElementById("aiHint");
  const originalPromptEl = document.getElementById("aiOriginalPrompt");
  const originalTaskEl = document.getElementById("aiOriginalTask");
  const originalOptionsEl = document.getElementById("aiOriginalOptions");
  const originalTextEl = document.getElementById("aiOriginalText");
  const originalImagesEl = document.getElementById("aiOriginalImages");
  const originalFilesEl = document.getElementById("aiOriginalFiles");
  const docInput = document.getElementById("aiDocs");
  const audioInput = document.getElementById("aiAudio");
  const attachmentList = document.getElementById("aiAttachmentList");

  const MAX_IMAGES = 3;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const TASK_OPTIONS = {
    rewrite: [
      { key: "tone", label: "Tone", default: "preserve", values: [["preserve", "Bevar tone"], ["professional", "Mere professionel"], ["natural", "Mere naturlig"]] }
    ],
    improve: [
      { key: "tone", label: "Tone", default: "neutral", values: [["neutral", "Neutral"], ["professional", "Professionel"], ["informal", "Uformel"]] },
      { key: "length", label: "Længde", default: "same", values: [["shorter", "Kortere"], ["same", "Samme længde"], ["detailed", "Mere uddybende"]] }
    ],
    professional: [
      { key: "audience", label: "Målgruppe", default: "colleague", values: [["colleague", "Intern kollega"], ["customer", "Kunde"], ["management", "Ledelse"]] }
    ],
    email: [
      { key: "recipient", label: "Modtager", default: "internal", values: [["internal", "Intern kollega"], ["customer", "Kunde"], ["supplier", "Leverandør / ekstern"]] },
      { key: "length", label: "Længde", default: "normal", values: [["short", "Kort"], ["normal", "Normal"], ["detailed", "Uddybende"]] }
    ],
    email_reply: [
      { key: "intent", label: "Hvad skal svaret gøre?", default: "neutral", values: [["accept", "Accepter"], ["reject", "Afvis"], ["clarify", "Spørg ind"], ["neutral", "Neutralt svar"]] },
      { key: "rejectTone", label: "Tone på afslag", default: "friendly", showWhen: { key: "intent", value: "reject" }, values: [["friendly", "Venligt"], ["firm", "Bestemt"]] }
    ],
    summarize: [
      { key: "compression", label: "Komprimering", default: "medium", values: [["light", "Let"], ["medium", "Middel"], ["heavy", "Meget"]] }
    ],
    translate: [
      { key: "language", label: "Oversæt til", default: "en", values: [["da", "Dansk"], ["en", "Engelsk"], ["de", "Tysk"], ["nl", "Hollandsk"], ["ro", "Rumænsk"], ["uk", "Ukrainsk"], ["fr", "Fransk"], ["es", "Spansk"], ["pl", "Polsk"]] },
      { key: "tone", label: "Tone", default: "preserve", values: [["preserve", "Bevar original tone"], ["professional", "Professionel"], ["natural", "Naturligt sprog"]] }
    ],
    explain: [
      { key: "level", label: "Detaljeniveau", default: "normal", values: [["simple", "Helt enkelt"], ["normal", "Normal"], ["technical", "Teknisk"]] }
    ],
    referat: [
      { key: "type", label: "Type", default: "meeting", values: [["meeting", "Mødereferat"], ["decisions", "Beslutningsreferat"], ["visit", "Kundebesøg / samtale"], ["brief", "Kort resumé"]] },
      { key: "detail", label: "Detaljeniveau", default: "normal", values: [["short", "Kort"], ["normal", "Normal"], ["detailed", "Udførligt"]] },
      { key: "format", label: "Form", default: "bullets", values: [["bullets", "Punktform"], ["prose", "Løbende tekst"]] },
      { key: "actions", label: "Handlingspunkter", default: "yes", values: [["yes", "Med opfølgning"], ["no", "Uden"]] },
      { key: "language", label: "Sprog", default: "da", values: [["da", "Dansk"], ["en", "Engelsk"]] }
    ],
    bullets: [
      { key: "detail", label: "Detaljer", default: "short", values: [["short", "Kort"], ["detailed", "Detaljeret"]] },
      { key: "headings", label: "Overskrifter", default: "yes", values: [["yes", "Med overskrifter"], ["no", "Kun punkter"]] }
    ]
  };

  let images = [];
  let previousResponseId = null;
  let conversationStarted = false;
  let originalPrompt = null;
  let conversationHistory = [];

  function setStatus(text, loading = false) {
    status.innerHTML = loading ? `<span class="aiSpinner"></span>${text}` : text;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function getOptionValues() {
    const values = {};
    taskOptionsEl.querySelectorAll(".aiOptionButtons[data-option-key]").forEach(group => {
      const selected = group.querySelector(".aiOptionButton.is-selected");
      if (selected) values[group.dataset.optionKey] = selected.dataset.value;
    });
    return values;
  }

  function updateConditionalOptions() {
    const values = getOptionValues();
    taskOptionsEl.querySelectorAll(".aiOptionGroup[data-show-key]").forEach(group => {
      group.hidden = values[group.dataset.showKey] !== group.dataset.showValue;
    });
  }

  function renderTaskOptions() {
    taskOptionsEl.innerHTML = "";
    const defs = TASK_OPTIONS[task.value] || [];

    defs.forEach(def => {
      const group = document.createElement("div");
      group.className = "aiOptionGroup";
      if (def.showWhen) {
        group.dataset.showKey = def.showWhen.key;
        group.dataset.showValue = def.showWhen.value;
      }

      const label = document.createElement("div");
      label.className = "aiLabel";
      label.textContent = def.label;

      const buttons = document.createElement("div");
      buttons.className = "aiOptionButtons";
      buttons.dataset.optionKey = def.key;
      buttons.dataset.optionLabel = def.label;
      buttons.setAttribute("role", "group");
      buttons.setAttribute("aria-label", def.label);

      def.values.forEach(([value, text]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "aiOptionButton";
        button.dataset.value = value;
        button.textContent = text;

        const selected = value === def.default;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");

        button.addEventListener("click", () => {
          buttons.querySelectorAll(".aiOptionButton").forEach(other => {
            const isSelected = other === button;
            other.classList.toggle("is-selected", isSelected);
            other.setAttribute("aria-pressed", isSelected ? "true" : "false");
          });
          updateConditionalOptions();
        });

        buttons.appendChild(button);
      });

      group.append(label, buttons);
      taskOptionsEl.appendChild(group);
    });

    updateConditionalOptions();
  }

  function getSelectedTaskOptions() {
    const values = {};
    const labels = [];

    taskOptionsEl.querySelectorAll(".aiOptionGroup").forEach(group => {
      if (group.hidden) return;
      const buttons = group.querySelector(".aiOptionButtons[data-option-key]");
      const selected = buttons?.querySelector(".aiOptionButton.is-selected");
      if (!buttons || !selected) return;

      values[buttons.dataset.optionKey] = selected.dataset.value;
      labels.push({
        label: buttons.dataset.optionLabel,
        value: selected.textContent || selected.dataset.value
      });
    });

    return { values, labels };
  }

  function renderImages() {
    imagePreview.innerHTML = "";
    images.forEach((img, index) => {
      const wrap = document.createElement("div");
      wrap.className = "aiThumb";

      const el = document.createElement("img");
      el.src = img.dataUrl;
      el.alt = img.name;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Fjern billede";
      remove.addEventListener("click", () => {
        images.splice(index, 1);
        renderImages();
      });

      wrap.append(el, remove);
      imagePreview.appendChild(wrap);
    });
  }

  /* ================= Dokumenter og lydfiler ================= */

  const MAX_ATTACHMENTS = 8;
  const MAX_TEXT_PER_ATTACHMENT = 400000;
  const MAX_BINARY_BYTES = 10 * 1024 * 1024;       // PDF og andre filer der sendes som fil
  const AUDIO_DIRECT_BYTES = 8 * 1024 * 1024;      // mindre lydfiler sendes som de er
  const AUDIO_DIRECT_EXT = ["mp3", "m4a", "wav", "webm", "ogg", "oga", "flac", "mp4", "mpeg", "mpga"];
  const AUDIO_EXT = [...AUDIO_DIRECT_EXT, "wma", "aac", "opus", "mov", "m4v", "3gp", "amr", "aiff", "aif"];
  const CHUNK_SECONDS = 150;                       // ca. 2,5 min pr. del (~4,8 MB som 16 kHz WAV)
  const TRANSCRIBE_CONCURRENCY = 3;
  const TEXT_EXT = ["txt", "csv", "tsv", "md", "json", "xml", "html", "htm", "log", "eml", "vtt", "srt",
    "js", "ts", "css", "sql", "ps1", "psm1", "sh", "bat", "cmd", "py", "cs", "java", "yml", "yaml", "ini", "cfg", "conf", "rtf"];

  const LIBS = {
    mammoth: "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js",
    xlsx: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
    jszip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
  };
  const loadedLibs = {};

  let attachments = [];
  let attachmentSeq = 0;

  function loadScript(url) {
    if (!loadedLibs[url]) {
      loadedLibs[url] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url;
        s.onload = resolve;
        s.onerror = () => { delete loadedLibs[url]; reject(new Error("Kunne ikke indlæse hjælpebibliotek")); };
        document.head.appendChild(s);
      });
    }
    return loadedLibs[url];
  }

  function fileExt(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function formatDuration(sec) {
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} t ${m} min` : `${m} min ${s % 60} sek`;
  }

  function isAudioFile(file) {
    return file.type.startsWith("audio/") || file.type.startsWith("video/") || AUDIO_EXT.includes(fileExt(file.name));
  }

  function isProcessing() {
    return attachments.some(a => a.status === "processing");
  }

  function updateSendState() {
    if (sendBtn.dataset.busy === "1") return;
    sendBtn.disabled = isProcessing();
  }

  function renderAttachments() {
    attachmentList.innerHTML = "";

    attachments.forEach(att => {
      const item = document.createElement("div");
      item.className = "aiAttachment" + (att.status === "error" ? " is-error" : "");

      const head = document.createElement("div");
      head.className = "aiAttachmentHead";

      const icon = document.createElement("div");
      icon.className = "aiAttachmentIcon";
      icon.textContent = att.source === "audio" ? "🎙️" : "📄";

      const main = document.createElement("div");
      main.className = "aiAttachmentMain";
      const name = document.createElement("div");
      name.className = "aiAttachmentName";
      name.textContent = att.name;
      name.title = att.name;
      const meta = document.createElement("div");
      meta.className = "aiAttachmentMeta";
      if (att.status === "processing" && att.statusText) {
        meta.innerHTML = `<span class="aiSpinner"></span>`;
        meta.appendChild(document.createTextNode(att.statusText));
      } else {
        meta.textContent = att.statusText || formatBytes(att.size);
      }
      main.append(name, meta);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "aiAttachmentRemove";
      remove.textContent = "×";
      remove.title = att.status === "processing" ? "Stop og fjern" : "Fjern fil";
      remove.addEventListener("click", () => {
        att.cancelled = true;
        attachments = attachments.filter(x => x !== att);
        renderAttachments();
      });

      head.append(icon, main, remove);
      item.appendChild(head);

      if (att.status === "processing" && typeof att.progress === "number") {
        const bar = document.createElement("div");
        bar.className = "aiProgress";
        const fill = document.createElement("div");
        fill.style.width = `${Math.round(att.progress * 100)}%`;
        bar.appendChild(fill);
        item.appendChild(bar);
      }

      if (att.status === "ready" && att.kind === "text" && att.text) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = att.source === "audio" ? "Vis transskription" : "Vis udtrukket tekst";
        const pre = document.createElement("div");
        pre.className = "aiAttachmentText";
        pre.textContent = att.text.length > 20000 ? att.text.slice(0, 20000) + "\n…" : att.text;
        details.append(summary, pre);

        if (att.source === "audio") {
          const copy = document.createElement("button");
          copy.type = "button";
          copy.className = "aiCopyMessage";
          copy.style.marginTop = ".35rem";
          copy.textContent = "Kopiér transskription";
          copy.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(att.text);
              copy.textContent = "Kopieret ✓";
              setTimeout(() => copy.textContent = "Kopiér transskription", 1400);
            } catch { setStatus("Kunne ikke kopiere automatisk."); }
          });
          details.appendChild(copy);
        }
        item.appendChild(details);
      }

      attachmentList.appendChild(item);
    });

    updateSendState();
  }

  function updateAttachment(att, patch) {
    Object.assign(att, patch);
    if (attachments.includes(att)) renderAttachments();
  }

  function limitText(text) {
    const t = String(text || "").replace(/\u0000/g, "").trim();
    return t.length > MAX_TEXT_PER_ATTACHMENT
      ? t.slice(0, MAX_TEXT_PER_ATTACHMENT) + "\n\n[Teksten er afkortet – filen var for lang]"
      : t;
  }

  /* ---------- Dokumenter ---------- */

  async function extractDocx(file) {
    await loadScript(LIBS.mammoth);
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value || "";
  }

  async function extractSpreadsheet(file) {
    await loadScript(LIBS.xlsx);
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    return wb.SheetNames.map(name => {
      const csv = window.XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
      return `### Ark: ${name}\n${csv}`;
    }).join("\n\n");
  }

  async function extractPptx(file) {
    await loadScript(LIBS.jszip);
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const num = p => Number((/(\d+)\.xml$/.exec(p) || [])[1] || 0);
    const slides = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b));
    const parser = new DOMParser();

    const textOf = xml => {
      const doc = parser.parseFromString(xml, "application/xml");
      return Array.from(doc.getElementsByTagName("a:p"))
        .map(p => Array.from(p.getElementsByTagName("a:t")).map(t => t.textContent).join(""))
        .filter(line => line.trim())
        .join("\n");
    };

    const out = [];
    for (const path of slides) {
      const n = num(path);
      const slideText = textOf(await zip.file(path).async("string"));
      const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
      const notes = notesFile ? textOf(await notesFile.async("string")).replace(/^\d+$/gm, "").trim() : "";
      out.push(`### Slide ${n}\n${slideText}${notes ? `\n[Noter]\n${notes}` : ""}`);
    }
    return out.join("\n\n");
  }

  async function processDocument(att, file) {
    const ext = fileExt(file.name);

    try {
      let text = null;

      if (file.type.startsWith("text/") || TEXT_EXT.includes(ext)) {
        text = await file.text();
      } else if (ext === "docx" || ext === "docm") {
        updateAttachment(att, { statusText: "Læser Word-dokument …" });
        text = await extractDocx(file);
      } else if (["xlsx", "xlsm", "xls", "xlsb", "ods"].includes(ext)) {
        updateAttachment(att, { statusText: "Læser regneark …" });
        text = await extractSpreadsheet(file);
      } else if (ext === "pptx" || ext === "pptm") {
        updateAttachment(att, { statusText: "Læser PowerPoint …" });
        text = await extractPptx(file);
      }

      if (text !== null) {
        const clean = limitText(text);
        if (!clean) throw new Error("Der blev ikke fundet nogen tekst i filen.");
        updateAttachment(att, {
          status: "ready", kind: "text", text: clean,
          statusText: `${formatBytes(file.size)} · ${clean.length.toLocaleString("da-DK")} tegn tekst`
        });
        return;
      }

      // PDF og alle andre typer sendes som fil direkte til AI.
      if (file.size > MAX_BINARY_BYTES) {
        throw new Error(`Filen er ${formatBytes(file.size)} – maks. 10 MB for denne filtype.`);
      }
      const data = await fileToDataUrl(file);
      const mime = file.type || "application/octet-stream";
      const fixed = data.startsWith("data:;") ? data.replace("data:;", `data:${mime};`) : data;
      updateAttachment(att, {
        status: "ready", kind: "file", data: fixed, mime,
        statusText: ext === "pdf" ? `${formatBytes(file.size)} · PDF` : `${formatBytes(file.size)} · sendes som fil`
      });
    } catch (err) {
      console.error("Dokument fejl:", err);
      updateAttachment(att, { status: "error", statusText: err.message || String(err) });
    }
  }

  /* ---------- Lydfiler ---------- */

  function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);          // PCM
    view.setUint16(22, 1, true);          // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, samples.length * 2, true);

    let o = 44;
    for (let i = 0; i < samples.length; i++, o += 2) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  async function decodeToMono16k(file) {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC) throw new Error("Browseren kan ikke afkode lyd. Brug Chrome eller Edge.");

    const ctx = new AC(1, 16000, 16000);
    const input = await file.arrayBuffer();
    let audio;
    try {
      audio = await ctx.decodeAudioData(input);
    } catch {
      throw new Error("Lydformatet kunne ikke afkodes i browseren. Konverter filen til mp3 eller m4a og prøv igen.");
    }

    const len = audio.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += ch[i];
    }
    if (audio.numberOfChannels > 1) {
      const f = 1 / audio.numberOfChannels;
      for (let i = 0; i < len; i++) mono[i] *= f;
    }
    return { samples: mono, sampleRate: audio.sampleRate, duration: audio.duration };
  }

  // Deler lyden i stykker af ca. CHUNK_SECONDS og klipper i det mest stille sted
  // inden for de sidste 12 sekunder, så sætninger så vidt muligt ikke skæres over.
  function splitSamples(samples, sampleRate) {
    const target = CHUNK_SECONDS * sampleRate;
    const search = 12 * sampleRate;
    const frame = Math.round(0.1 * sampleRate);
    const parts = [];
    let start = 0;

    while (start < samples.length) {
      if (samples.length - start <= target + search) {
        parts.push([start, samples.length]);
        break;
      }
      let bestEnd = start + target;
      let bestEnergy = Infinity;
      for (let pos = start + target - search; pos + frame <= start + target; pos += frame) {
        let e = 0;
        for (let i = pos; i < pos + frame; i++) e += samples[i] * samples[i];
        if (e < bestEnergy) { bestEnergy = e; bestEnd = pos + Math.round(frame / 2); }
      }
      parts.push([start, bestEnd]);
      start = bestEnd;
    }
    return parts;
  }

  async function transcribeBlob(blob, name, mime) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`/api/ai-transcribe?name=${encodeURIComponent(name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", "X-File-Type": mime || blob.type || "application/octet-stream" },
          body: blob
        });
        const raw = await r.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
        if (!r.ok) throw new Error(data.message || data.error || `Fejl ${r.status}`);
        return String(data.text || "").trim();
      } catch (err) {
        lastErr = err;
        await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async function processAudio(att, file) {
    const ext = fileExt(file.name);

    try {
      // Små filer i et format OpenAI forstår sendes direkte.
      if (file.size <= AUDIO_DIRECT_BYTES && AUDIO_DIRECT_EXT.includes(ext)) {
        updateAttachment(att, { statusText: "Transskriberer lydfil …", progress: 0.3 });
        const text = await transcribeBlob(file, file.name, file.type);
        if (att.cancelled) return;
        if (!text) throw new Error("Der blev ikke fundet nogen tale i lydfilen.");
        updateAttachment(att, {
          status: "ready", kind: "text", text: limitText(text), progress: null,
          statusText: `${formatBytes(file.size)} · transskriberet · ${text.length.toLocaleString("da-DK")} tegn`
        });
        return;
      }

      updateAttachment(att, { statusText: "Afkoder lydfil i browseren …", progress: 0 });
      const { samples, sampleRate, duration } = await decodeToMono16k(file);
      if (att.cancelled) return;

      const ranges = splitSamples(samples, sampleRate);
      const results = new Array(ranges.length);
      let done = 0;
      let next = 0;

      const setProgress = () => updateAttachment(att, {
        progress: done / ranges.length,
        statusText: `${formatDuration(duration)} lyd · transskriberer del ${Math.min(done + 1, ranges.length)} af ${ranges.length} …`
      });
      setProgress();

      async function worker() {
        while (next < ranges.length) {
          if (att.cancelled) return;
          const i = next++;
          const [a, b] = ranges[i];
          const blob = encodeWav(samples.subarray(a, b), sampleRate);
          results[i] = await transcribeBlob(blob, `del-${i + 1}.wav`, "audio/wav");
          done++;
          if (!att.cancelled) setProgress();
        }
      }

      await Promise.all(Array.from({ length: Math.min(TRANSCRIBE_CONCURRENCY, ranges.length) }, worker));
      if (att.cancelled) return;

      const text = results.filter(Boolean).join("\n\n");
      if (!text.trim()) throw new Error("Der blev ikke fundet nogen tale i lydfilen.");

      updateAttachment(att, {
        status: "ready", kind: "text", text: limitText(text), progress: null,
        statusText: `${formatBytes(file.size)} · ${formatDuration(duration)} · transskriberet · ${text.length.toLocaleString("da-DK")} tegn`
      });
    } catch (err) {
      console.error("Lyd fejl:", err);
      if (!att.cancelled) updateAttachment(att, { status: "error", progress: null, statusText: err.message || String(err) });
    }
  }

  /* ---------- Fælles tilføj-funktion for begge knapper ---------- */

  async function addFiles(fileList, preferred) {
    const files = Array.from(fileList || []);

    for (const file of files) {
      // Billeder valgt via dokument-knappen lægges til billederne.
      if (preferred === "document" && file.type.startsWith("image/") && images.length < MAX_IMAGES && file.size <= MAX_FILE_BYTES) {
        images.push({ name: file.name, dataUrl: await fileToDataUrl(file) });
        renderImages();
        continue;
      }

      if (attachments.length >= MAX_ATTACHMENTS) {
        setStatus(`Du kan højst vedhæfte ${MAX_ATTACHMENTS} filer.`);
        break;
      }

      const source = isAudioFile(file) ? "audio" : "document";
      const att = {
        id: ++attachmentSeq,
        name: file.name,
        size: file.size,
        source,
        status: "processing",
        statusText: source === "audio" ? "Forbereder lydfil …" : "Læser fil …",
        progress: source === "audio" ? 0 : null
      };
      attachments.push(att);
      renderAttachments();

      if (source === "audio") processAudio(att, file);
      else processDocument(att, file);
    }
  }

  function readyAttachmentsPayload() {
    return attachments
      .filter(a => a.status === "ready")
      .map(a => a.kind === "text"
        ? { kind: "text", name: a.name, source: a.source, text: a.text }
        : { kind: "file", name: a.name, source: a.source, mime: a.mime, data: a.data });
  }

  function fileChips(container, files) {
    container.innerHTML = "";
    (files || []).forEach(f => {
      const chip = document.createElement("span");
      chip.className = "aiFileChip";
      chip.textContent = `${f.source === "audio" ? "🎙️" : "📄"} ${f.name}`;
      container.appendChild(chip);
    });
  }

  async function waitForBackground(id) {
    const started = Date.now();
    let delay = 2000;
    while (Date.now() - started < 15 * 60 * 1000) {
      await new Promise(res => setTimeout(res, delay));
      delay = Math.min(delay + 500, 4000);
      const secs = Math.round((Date.now() - started) / 1000);
      setStatus(`AI arbejder … (${secs} sek)`, true);

      const r = await fetch(`/api/ai?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const raw = await r.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
      if (!r.ok) throw new Error(data.message || data.error || `Fejl ${r.status}`);
      if (!data.pending) return data;
    }
    throw new Error("AI brugte for lang tid. Prøv igen, evt. med mindre indhold.");
  }

  function updatePromptForTask() {
    if (conversationStarted) return;
    if (task.value === "referat") {
      promptLabel.textContent = "Ekstra instruktion eller tekst (valgfrit)";
      prompt.placeholder = "Tilføj en lydfil eller et dokument – eller indsæt noter/transskription her.\nDu kan også skrive f.eks. deltagere, mødets formål eller hvad der skal fokuseres på.";
    } else {
      promptLabel.textContent = "Tekst eller spørgsmål";
      prompt.placeholder = "Indsæt f.eks. teksten fra en PowerPoint her …";
    }
  }

  function showOriginalPrompt() {
    if (!originalPrompt) return;
    originalTaskEl.textContent = originalPrompt.taskLabel;
    originalOptionsEl.innerHTML = "";
    (originalPrompt.optionLabels || []).forEach(item => {
      const chip = document.createElement("span");
      chip.className = "aiOriginalOption";
      chip.textContent = `${item.label}: ${item.value}`;
      originalOptionsEl.appendChild(chip);
    });
    originalTextEl.textContent = originalPrompt.text || (originalPrompt.images.length ? "Billede vedhæftet" : (originalPrompt.files?.length ? "Fil vedhæftet" : ""));
    originalImagesEl.innerHTML = "";
    originalPrompt.images.forEach(img => {
      const el = document.createElement("img");
      el.src = img.dataUrl;
      el.alt = img.name || "Vedhæftet billede";
      originalImagesEl.appendChild(el);
    });
    fileChips(originalFilesEl, originalPrompt.files);
    originalPromptEl.hidden = false;
  }

  function addMessage(role, text, attachedImages = [], attachedFiles = []) {
    conversationEl.hidden = false;

    const msg = document.createElement("div");
    msg.className = `aiMessage ${role === "user" ? "aiMessageUser" : "aiMessageAssistant"}`;

    const roleEl = document.createElement("div");
    roleEl.className = "aiMessageRole";
    roleEl.textContent = role === "user" ? "Dig" : "Herrup AI";

    const bubble = document.createElement("div");
    bubble.className = "aiMessageBubble";
    bubble.textContent = text || (attachedImages.length ? "Billede vedhæftet" : (attachedFiles.length ? "Fil vedhæftet" : ""));

    msg.append(roleEl, bubble);

    if (attachedFiles.length) {
      const files = document.createElement("div");
      files.className = "aiMessageFiles";
      fileChips(files, attachedFiles);
      msg.appendChild(files);
    }

    if (attachedImages.length) {
      const imgs = document.createElement("div");
      imgs.className = "aiMessageImages";
      attachedImages.forEach(img => {
        const el = document.createElement("img");
        el.src = img.dataUrl;
        el.alt = img.name || "Vedhæftet billede";
        imgs.appendChild(el);
      });
      msg.appendChild(imgs);
    }

    if (role === "assistant" && text) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "aiCopyMessage";
      copy.textContent = "Kopiér svar";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          copy.textContent = "Kopieret ✓";
          setTimeout(() => copy.textContent = "Kopiér svar", 1400);
        } catch {
          setStatus("Kunne ikke kopiere automatisk.");
        }
      });
      msg.appendChild(copy);
    }

    conversationEl.appendChild(msg);
  }

  function switchToFollowupMode() {
    if (conversationStarted) return;
    conversationStarted = true;
    taskWrap.hidden = true;
    newConversationBtn.hidden = false;
    savePdfBtn.hidden = false;
    bottomActions.hidden = false;
    composerTitle.textContent = "Fortsæt samtalen";
    promptLabel.textContent = "Opfølgende spørgsmål";
    prompt.placeholder = "Stil et opfølgende spørgsmål …";
    prompt.rows = 4;
    prompt.classList.add("aiFollowup");
    hint.innerHTML = "<strong>Tip:</strong> Du kan nu henvise til det tidligere svar, f.eks. “gør den kortere”, “skriv den mere uformelt” eller “hvad mener du med punkt 2?”.";
  }

  function resetConversation() {
    previousResponseId = null;
    conversationStarted = false;
    originalPrompt = null;
    conversationHistory = [];
    conversationEl.innerHTML = "";
    conversationEl.hidden = true;
    originalPromptEl.hidden = true;
    originalTaskEl.textContent = "";
    originalOptionsEl.innerHTML = "";
    originalTextEl.textContent = "";
    originalImagesEl.innerHTML = "";
    originalFilesEl.innerHTML = "";
    taskWrap.hidden = false;
    newConversationBtn.hidden = true;
    savePdfBtn.hidden = true;
    bottomActions.hidden = true;
    composerTitle.textContent = "Formuler dit spørgsmål";
    promptLabel.textContent = "Tekst eller spørgsmål";
    prompt.placeholder = "Indsæt f.eks. teksten fra en PowerPoint her …";
    prompt.rows = 10;
    prompt.classList.remove("aiFollowup");
    hint.innerHTML = "<strong>Tip:</strong> Til almindelig korrektur behøver du ikke skrive en instruktion. Vælg <em>Ret tekst</em>, indsæt teksten og tryk Send. Undgå at indsætte passwords, API-nøgler eller andre hemmeligheder.";
    prompt.value = "";
    images = [];
    renderImages();
    attachments.forEach(a => a.cancelled = true);
    attachments = [];
    renderAttachments();
    updatePromptForTask();
    setStatus("");
    prompt.focus();
  }

  function safePdfText(value) {
    return String(value || "")
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201c|\u201d/g, '"');
  }

  function saveConversationPdf() {
    if (!conversationStarted || !originalPrompt) return;

    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) {
      setStatus("PDF-funktionen kunne ikke indlæses. Genindlæs siden og prøv igen.");
      return;
    }

    try {
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 18;
      const textWidth = pageWidth - margin * 2;
      let y = 18;

      function ensureSpace(required = 12) {
        if (y + required > pageHeight - 18) {
          doc.addPage();
          y = 18;
        }
      }

      function writeText(text, options = {}) {
        const size = options.size || 10;
        const style = options.style || "normal";
        const gapAfter = options.gapAfter ?? 4;
        const indent = options.indent || 0;
        const width = textWidth - indent;
        doc.setFont("helvetica", style);
        doc.setFontSize(size);
        const lines = doc.splitTextToSize(safePdfText(text), width);
        const lineHeight = size * 0.42;
        for (const line of lines) {
          ensureSpace(lineHeight + 2);
          doc.text(line, margin + indent, y);
          y += lineHeight;
        }
        y += gapAfter;
      }

      function writeImages(imgs) {
        if (!imgs?.length) return;
        const thumbW = 42;
        const thumbH = 30;
        let x = margin;
        ensureSpace(thumbH + 5);
        for (const img of imgs) {
          if (x + thumbW > pageWidth - margin) {
            x = margin;
            y += thumbH + 5;
            ensureSpace(thumbH + 5);
          }
          try {
            doc.addImage(img.dataUrl, undefined, x, y, thumbW, thumbH, undefined, "FAST");
            x += thumbW + 5;
          } catch (e) {
            console.warn("Kunne ikke tilføje billede til PDF:", e);
          }
        }
        y += thumbH + 7;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("Herrup AI - samtale", margin, y);
      y += 9;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Gemt: ${new Date().toLocaleString("da-DK")}`, margin, y);
      y += 10;

      doc.setDrawColor(210);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      writeText("Oprindeligt spørgsmål", { size: 13, style: "bold", gapAfter: 3 });
      writeText(`Valg: ${originalPrompt.taskLabel}`, { size: 9, style: "bold", gapAfter: 2 });
      for (const item of (originalPrompt.optionLabels || [])) {
        writeText(`${item.label}: ${item.value}`, { size: 9, gapAfter: 1 });
      }
      y += 2;
      if (originalPrompt.text) writeText(originalPrompt.text, { size: 10, gapAfter: 5 });
      if (originalPrompt.files?.length) writeText(`Vedhæftet: ${originalPrompt.files.map(f => f.name).join(", ")}`, { size: 9, gapAfter: 4 });
      writeImages(originalPrompt.images);

      writeText("Samtale", { size: 13, style: "bold", gapAfter: 5 });

      for (const item of conversationHistory) {
        // Første brugerbesked står allerede i afsnittet "Oprindeligt spørgsmål".
        if (item.isOriginal) continue;
        const label = item.role === "user" ? "Dig" : "Herrup AI";
        writeText(label, { size: 9, style: "bold", gapAfter: 2 });
        if (item.text) writeText(item.text, { size: 10, gapAfter: 4, indent: 2 });
        if (item.files?.length) writeText(`Vedhæftet: ${item.files.map(f => f.name).join(", ")}`, { size: 9, gapAfter: 3, indent: 2 });
        writeImages(item.images);
        ensureSpace(5);
      }

      const stamp = new Date().toISOString().slice(0, 10);
      doc.save(`Herrup-AI-samtale-${stamp}.pdf`);
      setStatus("Samtalen er gemt som PDF.");
    } catch (err) {
      console.error("PDF fejl:", err);
      setStatus(`Kunne ikke gemme PDF: ${err.message || err}`);
    }
  }

  imageInput.addEventListener("change", async () => {
    const files = Array.from(imageInput.files || []);
    for (const file of files) {
      if (images.length >= MAX_IMAGES) break;
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_FILE_BYTES) {
        setStatus(`${file.name} er større end 4 MB.`);
        continue;
      }
      images.push({ name: file.name, dataUrl: await fileToDataUrl(file) });
    }
    imageInput.value = "";
    renderImages();
  });

  docInput.addEventListener("change", async () => {
    const files = docInput.files;
    await addFiles(files, "document");
    docInput.value = "";
  });

  audioInput.addEventListener("change", async () => {
    const files = audioInput.files;
    await addFiles(files, "audio");
    audioInput.value = "";
  });

  clearBtn.addEventListener("click", () => {
    prompt.value = "";
    images = [];
    renderImages();
    attachments.forEach(a => a.cancelled = true);
    attachments = [];
    renderAttachments();
    setStatus("");
    prompt.focus();
  });

  newConversationBtn.addEventListener("click", resetConversation);
  savePdfBtn.addEventListener("click", saveConversationPdf);
  newConversationBottomBtn.addEventListener("click", resetConversation);
  savePdfBottomBtn.addEventListener("click", saveConversationPdf);

  async function send() {
    const text = prompt.value.trim();
    if (isProcessing()) {
      setStatus("Vent til filerne er færdigbehandlet.");
      return;
    }
    const sentAttachments = readyAttachmentsPayload();
    if (!text && images.length === 0 && sentAttachments.length === 0) {
      setStatus("Skriv et spørgsmål eller tilføj et billede, dokument eller en lydfil.");
      prompt.focus();
      return;
    }

    const sentImages = images.map(x => ({ ...x }));
    const sentFiles = sentAttachments.map(a => ({ name: a.name, source: a.source }));
    const sentTask = task.value;
    const sentTaskLabel = task.options[task.selectedIndex]?.text || sentTask;
    const selectedTaskOptions = getSelectedTaskOptions();
    const sentOptions = selectedTaskOptions.values;
    const sentOptionLabels = selectedTaskOptions.labels;
    const currentPreviousResponseId = previousResponseId;
    const isFirstMessage = !conversationStarted;

    sendBtn.disabled = true;
    sendBtn.dataset.busy = "1";
    clearBtn.disabled = true;
    newConversationBtn.disabled = true;
    savePdfBtn.disabled = true;
    newConversationBottomBtn.disabled = true;
    savePdfBottomBtn.disabled = true;
    setStatus("AI arbejder …", true);

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          task: sentTask,
          prompt: text,
          images: sentImages.map(x => x.dataUrl),
          attachments: sentAttachments,
          options: sentOptions,
          previousResponseId: currentPreviousResponseId
        })
      });

      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
      if (response.status === 413) throw new Error("Filerne er for store til at sende samlet. Fjern en eller flere filer.");
      if (!response.ok) throw new Error(data.message || data.error || `Fejl ${response.status}`);
      if (data.pending && data.responseId) data = await waitForBackground(data.responseId);

      if (isFirstMessage) {
        originalPrompt = {
          task: sentTask,
          taskLabel: sentTaskLabel,
          optionLabels: sentOptionLabels,
          options: sentOptions,
          text,
          images: sentImages,
          files: sentFiles
        };
        conversationHistory.push({ role: "user", text, images: sentImages, files: sentFiles, isOriginal: true });
        showOriginalPrompt();
      } else {
        conversationHistory.push({ role: "user", text, images: sentImages, files: sentFiles, isOriginal: false });
        addMessage("user", text, sentImages, sentFiles);
      }

      const answerText = data.answer || "Der kom ikke noget svar.";
      conversationHistory.push({ role: "assistant", text: answerText, images: [], isOriginal: false });
      addMessage("assistant", answerText);

      previousResponseId = data.responseId || null;
      switchToFollowupMode();

      prompt.value = "";
      images = [];
      renderImages();
      attachments = attachments.filter(a => a.status === "processing");
      renderAttachments();
      setStatus("");
      prompt.focus();

      const last = conversationEl.lastElementChild;
      if (last) last.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      console.error("AI fejl:", err);
      setStatus(`Fejl: ${err.message || err}`);
    } finally {
      delete sendBtn.dataset.busy;
      sendBtn.disabled = isProcessing();
      clearBtn.disabled = false;
      newConversationBtn.disabled = false;
      savePdfBtn.disabled = false;
      newConversationBottomBtn.disabled = false;
      savePdfBottomBtn.disabled = false;
    }
  }

  task.addEventListener("change", () => { renderTaskOptions(); updatePromptForTask(); });
  renderTaskOptions();
  updatePromptForTask();

  sendBtn.addEventListener("click", send);
  prompt.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  });
})();
