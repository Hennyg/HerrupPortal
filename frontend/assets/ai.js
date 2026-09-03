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
  const status = document.getElementById("aiStatus");
  const conversationEl = document.getElementById("aiConversation");
  const composerTitle = document.getElementById("aiComposerTitle");
  const hint = document.getElementById("aiHint");

  const MAX_IMAGES = 3;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;

  let images = [];
  let previousResponseId = null;
  let conversationStarted = false;

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
    conversationEl.innerHTML = "";
    conversationEl.hidden = true;
    taskWrap.hidden = false;
    newConversationBtn.hidden = true;
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

  async function send() {
    const text = prompt.value.trim();
    if (!text && images.length === 0) {
      setStatus("Skriv et spørgsmål eller tilføj et billede.");
      prompt.focus();
      return;
    }

    const sentImages = images.map(x => ({ ...x }));
    const sentTask = task.value;
    const currentPreviousResponseId = previousResponseId;

    sendBtn.disabled = true;
    clearBtn.disabled = true;
    newConversationBtn.disabled = true;
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

      addMessage("user", text, sentImages);
      addMessage("assistant", data.answer || "Der kom ikke noget svar.");

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
