(() => {
  const task = document.getElementById("aiTask");
  const prompt = document.getElementById("aiPrompt");
  const imageInput = document.getElementById("aiImages");
  const imagePreview = document.getElementById("aiImagePreview");
  const sendBtn = document.getElementById("aiSend");
  const clearBtn = document.getElementById("aiClear");
  const copyBtn = document.getElementById("aiCopy");
  const status = document.getElementById("aiStatus");
  const answerPanel = document.getElementById("aiAnswerPanel");
  const answer = document.getElementById("aiAnswer");

  const MAX_IMAGES = 3;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  let images = [];

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
    answer.textContent = "";
    answerPanel.hidden = true;
    setStatus("");
    prompt.focus();
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(answer.textContent || "");
      copyBtn.textContent = "Kopieret ✓";
      setTimeout(() => copyBtn.textContent = "Kopiér svar", 1400);
    } catch {
      setStatus("Kunne ikke kopiere automatisk.");
    }
  });

  async function send() {
    const text = prompt.value.trim();
    if (!text && images.length === 0) {
      setStatus("Skriv et spørgsmål eller tilføj et billede.");
      prompt.focus();
      return;
    }

    sendBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("AI arbejder …", true);
    answerPanel.hidden = true;

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          task: task.value,
          prompt: text,
          images: images.map(x => x.dataUrl)
        })
      });

      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
      if (!response.ok) throw new Error(data.message || data.error || `Fejl ${response.status}`);

      answer.textContent = data.answer || "Der kom ikke noget svar.";
      answerPanel.hidden = false;
      setStatus("");
      answerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      console.error("AI fejl:", err);
      setStatus(`Fejl: ${err.message || err}`);
    } finally {
      sendBtn.disabled = false;
      clearBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", send);
  prompt.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
  });
})();
