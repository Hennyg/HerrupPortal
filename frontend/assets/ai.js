(() => {
  const task = document.getElementById("aiTask");
  const taskWrap = document.getElementById("aiTaskWrap");
  const prompt = document.getElementById("aiPrompt");
  const promptLabel = document.getElementById("aiPromptLabel");
  const imageInput = document.getElementById("aiImages");
  const imagePreview = document.getElementById("aiImagePreview");
  const sendBtn = document.getElementById("aiSend");
  const clearBtn = document.getElementById("aiClear");
  const newConversationBtn = document.getElementById("aiNewConversation");
  const savePdfBtn = document.getElementById("aiSavePdf");
  const status = document.getElementById("aiStatus");
  const conversationEl = document.getElementById("aiConversation");
  const composerTitle = document.getElementById("aiComposerTitle");
  const hint = document.getElementById("aiHint");
  const originalPromptEl = document.getElementById("aiOriginalPrompt");
  const originalTaskEl = document.getElementById("aiOriginalTask");
  const originalTextEl = document.getElementById("aiOriginalText");
  const originalImagesEl = document.getElementById("aiOriginalImages");

  const MAX_IMAGES = 3;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;

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

  function showOriginalPrompt() {
    if (!originalPrompt) return;
    originalTaskEl.textContent = originalPrompt.taskLabel;
    originalTextEl.textContent = originalPrompt.text || (originalPrompt.images.length ? "Billede vedhæftet" : "");
    originalImagesEl.innerHTML = "";
    originalPrompt.images.forEach(img => {
      const el = document.createElement("img");
      el.src = img.dataUrl;
      el.alt = img.name || "Vedhæftet billede";
      originalImagesEl.appendChild(el);
    });
    originalPromptEl.hidden = false;
  }

  function addMessage(role, text, attachedImages = []) {
    conversationEl.hidden = false;

    const msg = document.createElement("div");
    msg.className = `aiMessage ${role === "user" ? "aiMessageUser" : "aiMessageAssistant"}`;

    const roleEl = document.createElement("div");
    roleEl.className = "aiMessageRole";
    roleEl.textContent = role === "user" ? "Dig" : "Herrup AI";

    const bubble = document.createElement("div");
    bubble.className = "aiMessageBubble";
    bubble.textContent = text || (attachedImages.length ? "Billede vedhæftet" : "");

    msg.append(roleEl, bubble);

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
    originalTextEl.textContent = "";
    originalImagesEl.innerHTML = "";
    taskWrap.hidden = false;
    newConversationBtn.hidden = true;
    savePdfBtn.hidden = true;
    composerTitle.textContent = "Formuler dit spørgsmål";
    promptLabel.textContent = "Tekst eller spørgsmål";
    prompt.placeholder = "Indsæt f.eks. teksten fra en PowerPoint her …";
    prompt.rows = 10;
    prompt.classList.remove("aiFollowup");
    hint.innerHTML = "<strong>Tip:</strong> Til almindelig korrektur behøver du ikke skrive en instruktion. Vælg <em>Ret tekst</em>, indsæt teksten og tryk Send. Undgå at indsætte passwords, API-nøgler eller andre hemmeligheder.";
    prompt.value = "";
    images = [];
    renderImages();
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
      writeText(`Valg: ${originalPrompt.taskLabel}`, { size: 9, style: "bold", gapAfter: 4 });
      if (originalPrompt.text) writeText(originalPrompt.text, { size: 10, gapAfter: 5 });
      writeImages(originalPrompt.images);

      writeText("Samtale", { size: 13, style: "bold", gapAfter: 5 });

      for (const item of conversationHistory) {
        // Første brugerbesked står allerede i afsnittet "Oprindeligt spørgsmål".
        if (item.isOriginal) continue;
        const label = item.role === "user" ? "Dig" : "Herrup AI";
        writeText(label, { size: 9, style: "bold", gapAfter: 2 });
        if (item.text) writeText(item.text, { size: 10, gapAfter: 4, indent: 2 });
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

  clearBtn.addEventListener("click", () => {
    prompt.value = "";
    images = [];
    renderImages();
    setStatus("");
    prompt.focus();
  });

  newConversationBtn.addEventListener("click", resetConversation);
  savePdfBtn.addEventListener("click", saveConversationPdf);

  async function send() {
    const text = prompt.value.trim();
    if (!text && images.length === 0) {
      setStatus("Skriv et spørgsmål eller tilføj et billede.");
      prompt.focus();
      return;
    }

    const sentImages = images.map(x => ({ ...x }));
    const sentTask = task.value;
    const sentTaskLabel = task.options[task.selectedIndex]?.text || sentTask;
    const currentPreviousResponseId = previousResponseId;
    const isFirstMessage = !conversationStarted;

    sendBtn.disabled = true;
    clearBtn.disabled = true;
    newConversationBtn.disabled = true;
    savePdfBtn.disabled = true;
    setStatus("AI arbejder …", true);

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          task: sentTask,
          prompt: text,
          images: sentImages.map(x => x.dataUrl),
          previousResponseId: currentPreviousResponseId
        })
      });

      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
      if (!response.ok) throw new Error(data.message || data.error || `Fejl ${response.status}`);

      if (isFirstMessage) {
        originalPrompt = {
          task: sentTask,
          taskLabel: sentTaskLabel,
          text,
          images: sentImages
        };
        conversationHistory.push({ role: "user", text, images: sentImages, isOriginal: true });
        showOriginalPrompt();
      } else {
        conversationHistory.push({ role: "user", text, images: sentImages, isOriginal: false });
        addMessage("user", text, sentImages);
      }

      const answerText = data.answer || "Der kom ikke noget svar.";
      conversationHistory.push({ role: "assistant", text: answerText, images: [], isOriginal: false });
      addMessage("assistant", answerText);

      previousResponseId = data.responseId || null;
      switchToFollowupMode();

      prompt.value = "";
      images = [];
      renderImages();
      setStatus("");
      prompt.focus();

      const last = conversationEl.lastElementChild;
      if (last) last.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      console.error("AI fejl:", err);
      setStatus(`Fejl: ${err.message || err}`);
    } finally {
      sendBtn.disabled = false;
      clearBtn.disabled = false;
      newConversationBtn.disabled = false;
      savePdfBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", send);
  prompt.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  });
})();
