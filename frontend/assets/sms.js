// assets/sms.js – SMS service (SMS.html)
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  let PRICE = 0.37;
  let history = [];
  let currentDetail = null;
  let ME = { phone: "", isAdmin: false };
  let aiItems = [];
  let busy = false;

  // ── Hjælpere ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  const kr = n => "kr. " + (Math.round(n * 100) / 100).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = d => d ? new Date(d).toLocaleString("da-DK", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  async function api(path, opts = {}) {
    const r = await fetch(path, {
      cache: "no-store",
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok) {
      const e = new Error(data?.error || `HTTP ${r.status}`);
      e.status = r.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  // Samme regler som serveren (api/_sms.js)
  function parseNumbers(text) {
    const valid = [], invalid = [], seen = new Set();
    let duplicates = 0;
    for (const line of String(text || "").split(/[\r\n,;]+/)) {
      const orig = line.trim();
      if (!orig) continue;
      let n = orig.replace(/[\s\-().]/g, "").replace(/^\+/, "");
      if (n.startsWith("00")) n = n.slice(2);
      if (/^\d{8}$/.test(n)) n = "45" + n;
      if (!/^\d{10,15}$/.test(n)) { invalid.push(orig); continue; }
      if (seen.has(n)) { duplicates++; continue; }
      seen.add(n);
      valid.push(n);
    }
    return { valid, invalid, duplicates };
  }

  const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const GSM_EXT = "^{}\\[~]|€";
  function smsInfo(text) {
    const t = String(text || "");
    let gsm = true, len = 0;
    const odd = new Set();
    for (const ch of t) {
      if (GSM_BASIC.includes(ch)) len += 1;
      else if (GSM_EXT.includes(ch)) len += 2;
      else { gsm = false; odd.add(ch); }
    }
    if (!gsm) len = [...t].length;
    const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
    const parts = len === 0 ? 0 : (len <= single ? 1 : Math.ceil(len / multi));
    // Tegn tilbage, før beskeden fylder én SMS mere.
    const left = parts <= 1 ? single - len : parts * multi - len;
    return { length: len, parts, gsm, odd: [...odd], left: Math.max(left, 0) };
  }

  // ── Send SMS ──────────────────────────────────────────────────────────────
  function recalc() {
    const nums = parseNumbers($("recipients").value);
    const info = smsInfo($("message").value.trim());
    const total = nums.valid.length * info.parts;

    $("recCount").textContent = nums.valid.length;
    $("msgLen").textContent = info.length;
    $("msgParts").textContent = info.parts;
    $("msgLeft").textContent = info.left;
    $("sumRec").textContent = nums.valid.length;
    $("sumParts").textContent = info.parts;
    $("sumSms").textContent = total;
    $("sumPrice").textContent = kr(total * PRICE);

    const rw = [];
    if (nums.invalid.length) rw.push(`${nums.invalid.length} ugyldige numre springes over: ${nums.invalid.slice(0, 5).map(esc).join(", ")}${nums.invalid.length > 5 ? " …" : ""}`);
    if (nums.duplicates) rw.push(`${nums.duplicates} dubletter fjernet`);
    $("recWarn").innerHTML = rw.join("<br>");

    const mw = [];
    if (!info.gsm) mw.push(`Beskeden indeholder specialtegn (${info.odd.slice(0, 5).map(esc).join(" ")}), så hver SMS kun kan være 70 tegn.`);
    if (info.parts > 6) mw.push("Beskeden er for lang – maks 6 SMS'er pr. modtager.");
    $("msgWarn").innerHTML = mw.join("<br>");

    const test = $("testMode").checked;
    const btn = $("sendBtn");
    btn.textContent = test ? "Send test" : "SEND";
    btn.classList.toggle("isTest", test);
    btn.disabled = busy || !nums.valid.length || !info.parts || info.parts > 6 || !$("from").value.trim();

    const msgOk = info.parts > 0 && info.parts <= 6 && !!$("from").value.trim();
    $("selfBtn").disabled = busy || !ME.phone || !msgOk;
    $("aiBtn").disabled = busy || !info.parts;
    return { nums, info, total, test };
  }

  async function send() {
    const { nums, total, test } = recalc();
    if (!test) {
      const ok = confirm(`Send ${total} SMS'er til ${nums.valid.length} modtagere?\n\nPris ca. ${kr(total * PRICE)}`);
      if (!ok) return;
    }
    busy = true;
    recalc();
    $("sendMsg").textContent = test ? "Tester…" : "Sender…";
    $("result").className = "smsResult";
    $("result").innerHTML = "";
    try {
      const r = await api("/api/sms-send", {
        method: "POST",
        body: { recipients: nums.valid, message: $("message").value, from: $("from").value.trim(), test }
      });
      showResult(r);
      if (!test) loadBalance();
      loadHistory();
    } catch (e) {
      showResult(e.data || { ok: false, error: e.message });
    } finally {
      busy = false;
      $("sendMsg").textContent = "";
      recalc();
    }
  }

  // ── Test til dig selv ─────────────────────────────────────────────────────
  // Sender rigtigt, men kun til dit eget nummer fra Entra. Modtagerfeltet røres ikke.
  async function sendSelf() {
    const info = smsInfo($("message").value.trim());
    if (!ME.phone || !info.parts) return;
    busy = true;
    recalc();
    $("sendMsg").textContent = "Sender til dig selv…";
    $("result").className = "smsResult";
    $("result").innerHTML = "";
    try {
      const r = await api("/api/sms-send", {
        method: "POST",
        body: { selfTest: true, message: $("message").value, from: $("from").value.trim() }
      });
      showResult(r);
      loadBalance();
      loadHistory().catch(() => {});
    } catch (e) {
      showResult(e.data || { ok: false, error: e.message });
    } finally {
      busy = false;
      $("sendMsg").textContent = "";
      recalc();
    }
  }

  async function loadMe() {
    try {
      ME = await api("/api/sms-me");
    } catch (e) {
      ME = { phone: "", isAdmin: false, phoneError: e.message };
    }
    if (ME.phone) {
      $("selfBtn").textContent = `Test til dig selv (+${ME.phone})`;
      $("selfInfo").textContent = "Sendes rigtigt, kun til dit eget nummer.";
    } else {
      $("selfInfo").textContent = ME.phoneError
        ? `Kunne ikke hente dit nummer: ${ME.phoneError}`
        : "Der er intet mobilnummer på din bruger i Entra.";
    }
    $("orderLink").style.display = ME.isAdmin ? "" : "none";
    $("histAllWrap").style.display = ME.isAdmin ? "" : "none";
    recalc();
  }

  // ── AI-kontrol af teksten ─────────────────────────────────────────────────
  async function checkWithAi() {
    const text = $("message").value;
    if (!text.trim()) return;
    $("aiBtn").disabled = true;
    $("aiMsg").textContent = "Kontrollerer…";
    try {
      const r = await api("/api/sms-ai", { method: "POST", body: { message: text } });
      aiItems = (r.suggestions || []).map(x => ({ ...x, state: "open" }));
      const before = smsInfo(text.trim());
      $("aiInfo").innerHTML = aiItems.length
        ? `${aiItems.length} forslag. Godkend dem, du vil bruge – teksten opdateres med det samme.`
        : `Ingen forslag – teksten ser fin ud (${before.parts} SMS, ${before.gsm ? "kun standardtegn" : "indeholder specialtegn"}).`;
      if (r.aiError) $("aiInfo").innerHTML += `<br><span style="color:#b45309">AI-delen fejlede: ${esc(r.aiError)}. Tegnkontrollen er stadig lavet.</span>`;
      renderAi();
      $("aiOverlay").hidden = false;
    } catch (e) {
      $("aiMsg").textContent = `Fejl: ${e.message}`;
      return;
    } finally {
      recalc();
    }
    $("aiMsg").textContent = "";
  }

  function canApply(it, text) { return text.includes(it.find); }

  function renderAi() {
    const text = $("message").value;
    aiItems.forEach(it => {
      if (it.state === "open" && !canApply(it, text)) it.state = "stale";
      if (it.state === "stale" && canApply(it, text)) it.state = "open";
    });
    const show = s => s === "" ? "(intet)" : s.replace(/\n/g, "↵");
    $("aiList").innerHTML = aiItems.map(it => {
      const status = it.state === "done" ? "✓ Godkendt" : it.state === "rejected" ? "Afvist" : it.state === "stale" ? "Teksten er ændret – kan ikke bruges" : "";
      const findShow = it.type === "tegn" ? `"${it.find}"` : it.find;
      return `
      <div class="aiItem ${it.state}" data-id="${esc(it.id)}">
        <div class="aiHead">
          <span class="badge ${it.type === "tegn" ? "tegn" : "sprog"}">${it.type === "tegn" ? "Specialtegn" : "Formulering"}</span>
          <span class="aiStatus">${esc(status)}</span>
        </div>
        <div class="aiReason">${esc(it.reason)}</div>
        <div class="aiDiff"><del>${esc(show(findShow))}</del> → <ins>${esc(show(it.replace))}</ins></div>
        ${it.state === "open" ? `<div class="aiActions">
          <button type="button" class="btn" data-act="reject">Afvis</button>
          <button type="button" class="btn primary" data-act="approve">Godkend</button>
        </div>` : ""}
      </div>`;
    }).join("");
    $("aiList").querySelectorAll("button[data-act]").forEach(b => {
      b.addEventListener("click", () => {
        const id = b.closest(".aiItem").getAttribute("data-id");
        if (b.getAttribute("data-act") === "approve") approveAi(id); else rejectAi(id);
      });
    });
    const info = smsInfo($("message").value.trim());
    $("aiCountLine").textContent = `Nu: ${info.length} tegn · ${info.parts} SMS · ${info.left} tegn til næste SMS`;
    $("aiApproveAll").disabled = !aiItems.some(x => x.state === "open");
  }

  function approveAi(id, rerender = true) {
    const it = aiItems.find(x => x.id === id);
    if (!it || it.state !== "open") return;
    const el = $("message");
    if (!el.value.includes(it.find)) { it.state = "stale"; if (rerender) renderAi(); return; }
    el.value = it.all ? el.value.split(it.find).join(it.replace) : el.value.replace(it.find, () => it.replace);
    it.state = "done";
    recalc();
    if (rerender) renderAi();
  }
  function rejectAi(id) {
    const it = aiItems.find(x => x.id === id);
    if (it && it.state === "open") it.state = "rejected";
    renderAi();
  }
  function approveAllAi() {
    aiItems.filter(x => x.state === "open").forEach(x => approveAi(x.id, false));
    renderAi();
  }
  function closeAi() { $("aiOverlay").hidden = true; }

  // ── Bestil SMS (admin) ────────────────────────────────────────────────────
  function orderCountValue() {
    return Number(String($("orderCount").value || "").replace(/[\s.]/g, ""));
  }
  function updateOrderPrice() {
    const n = orderCountValue();
    $("orderPrice").textContent = Number.isInteger(n) && n > 0 ? `Ca. ${kr(n * PRICE)} (${PRICE.toLocaleString("da-DK")} kr. pr. SMS)` : "Skriv et helt tal.";
  }
  function openOrder(e) {
    if (e) e.preventDefault();
    $("orderCount").value = "5000";
    $("orderResult").className = "smsResult";
    $("orderResult").innerHTML = "";
    $("orderSend").disabled = false;
    $("orderBalance").textContent = $("balance").textContent;
    updateOrderPrice();
    $("orderOverlay").hidden = false;
    setTimeout(() => $("orderCount").select(), 50);
  }
  function closeOrder() { $("orderOverlay").hidden = true; }

  async function sendOrder() {
    const n = orderCountValue();
    if (!Number.isInteger(n) || n < 100) { updateOrderPrice(); $("orderResult").className = "smsResult err"; $("orderResult").textContent = "Antal skal være et helt tal på mindst 100."; return; }
    if (!confirm(`Bestil ${n.toLocaleString("da-DK")} SMS'er hos Sveve?`)) return;
    $("orderSend").disabled = true;
    $("orderResult").className = "smsResult";
    $("orderResult").textContent = "Bestiller…";
    try {
      const r = await api("/api/sms-order", { method: "POST", body: { count: n } });
      $("orderResult").className = "smsResult ok";
      $("orderResult").innerHTML = `<strong>Bestilt:</strong> ${n.toLocaleString("da-DK")} SMS'er.${r.svar ? `<br>Svar fra Sveve: ${esc(r.svar)}` : ""}`;
      await loadBalance();
      $("orderBalance").textContent = $("balance").textContent;
    } catch (e) {
      $("orderResult").className = "smsResult err";
      $("orderResult").innerHTML = `<strong>Fejl:</strong> ${esc(e.data?.error || e.message)}`;
      $("orderSend").disabled = false;
    }
  }

  function showResult(r) {
    const el = $("result");
    const hasErrors = !r.ok || (r.errors && r.errors.length);
    el.className = "smsResult " + (hasErrors ? "err" : "ok");
    let html = "";
    if (!r.ok) {
      html = `<strong>Fejl:</strong> ${esc(r.error || "Ukendt fejl")}`;
    } else {
      html = r.test
        ? `<strong>Test OK.</strong> ${r.okCount ?? r.recipients} af ${r.recipients} numre godkendt – ${r.smsCount} SMS'er (${kr(r.price)}). Intet er sendt.`
        : r.selfTest
          ? `<strong>Sendt til dig selv</strong> (+${esc(r.selfPhone || "")}) – ${r.smsCount} SMS'er (${kr(r.price)}).`
          : `<strong>Sendt.</strong> ${r.okCount ?? r.recipients} af ${r.recipients} modtagere – ${r.smsCount} SMS'er (${kr(r.price)}).`;
    }
    if (r.errors && r.errors.length) {
      html += `<ul>${r.errors.slice(0, 20).map(x => `<li>${esc(x.number)}: ${esc(x.message)}</li>`).join("")}</ul>`;
      if (r.errors.length > 20) html += `<div>… og ${r.errors.length - 20} flere</div>`;
    }
    if (r.skippedInvalid && r.skippedInvalid.length) html += `<div>${r.skippedInvalid.length} ugyldige numre blev sprunget over.</div>`;
    if (r.logError) html += `<div>Bemærk: forsendelsen kunne ikke gemmes i historikken (${esc(r.logError)}).</div>`;
    el.innerHTML = html;
  }

  function reset() {
    $("recipients").value = "";
    $("message").value = "";
    $("from").value = "Lely Center";
    $("testMode").checked = true;
    $("result").className = "smsResult";
    $("result").innerHTML = "";
    recalc();
  }

  async function loadBalance() {
    $("balance").textContent = "henter…";
    try {
      const r = await api("/api/sms-balance");
      if (r.price) PRICE = r.price;
      $("balance").textContent = r.count !== null && r.count !== undefined
        ? `${Number(r.count).toLocaleString("da-DK")} SMS'er`
        : (r.raw || "ukendt");
    } catch (e) {
      $("balance").textContent = "kunne ikke hentes";
      console.warn("sms-balance:", e);
    }
    recalc();
  }

  // ── Historik ──────────────────────────────────────────────────────────────
  function statusBadge(it) {
    const s = (it.status || "").toLowerCase();
    if (s.includes("fejl")) return `<span class="badge err">${esc(it.status)}</span>`;
    if (s.includes("delvist")) return `<span class="badge part">${esc(it.status)}</span>`;
    if (it.test) return `<span class="badge test">Test</span>`;
    return `<span class="badge sent">Sendt</span>`;
  }

  function renderHistory() {
    const q = $("histSearch").value.trim().toLowerCase();
    const hideTest = $("histHideTest").checked;
    $("histSearchX").style.visibility = q ? "visible" : "hidden";

    const list = history.filter(it => {
      if (hideTest && it.test) return false;
      if (!q) return true;
      return (it.afsender + " " + it.afsenderMail + " " + it.besked + " " + it.modtagere).toLowerCase().includes(q);
    });

    $("histCount").textContent = `${list.length} af ${history.length}`;
    if (!list.length) {
      $("histBody").innerHTML = `<tr><td colspan="6" class="muted">${history.length ? "Ingen match" : "Ingen SMS'er endnu"}</td></tr>`;
      return;
    }
    $("histBody").innerHTML = list.map(it => `
      <tr data-id="${esc(it.id)}">
        <td style="white-space:nowrap">${esc(fmtDate(it.sendt))}</td>
        <td>${esc(it.afsender)}</td>
        <td class="smsMsgCell" title="${esc(it.besked)}">${esc(it.besked)}</td>
        <td class="num">${it.antalModtagere ?? ""}</td>
        <td class="num">${it.antalSms ?? ""}</td>
        <td>${statusBadge(it)}</td>
      </tr>`).join("");
    $("histBody").querySelectorAll("tr[data-id]").forEach(tr => {
      tr.addEventListener("click", () => openDetail(tr.getAttribute("data-id")));
    });
  }

  async function loadHistory() {
    try {
      const all = ME.isAdmin && $("histAll").checked ? "&all=1" : "";
      const r = await api(`/api/sms-log?top=500${all}`);
      // Nyeste først
      history = (r.items || []).slice().sort((a, b) => (Date.parse(b.sendt) || 0) - (Date.parse(a.sendt) || 0));
      if (r.price) PRICE = r.price;
      renderHistory();
      return r;
    } catch (e) {
      $("histBody").innerHTML = `<tr><td colspan="6" class="muted">Kunne ikke hente historik: ${esc(e.message)}</td></tr>`;
      throw e;
    }
  }

  function openDetail(id) {
    const it = history.find(x => x.id === id);
    if (!it) return;
    currentDetail = it;
    $("detailTitle").textContent = it.titel || "SMS";
    const meta = [
      ["Sendt", fmtDate(it.sendt)],
      ["Afsender", it.afsender + (it.afsenderMail ? ` (${it.afsenderMail})` : "")],
      ["Afsendernavn", it.fra || "–"],
      ["Modtagere", it.antalModtagere ?? "–"],
      ["Antal SMS", it.antalSms ?? "–"],
      ["Pris ca.", it.antalSms ? kr(it.antalSms * PRICE) : "–"],
      ["Status", it.status || (it.test ? "Test" : "Sendt")]
    ];
    $("detailMeta").innerHTML = meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    $("detailRec").textContent = it.modtagere || "";
    $("detailMsg").textContent = it.besked || "";
    $("detailOverlay").hidden = false;
  }
  function closeDetail() { $("detailOverlay").hidden = true; currentDetail = null; }

  function reuseDetail() {
    if (!currentDetail) return;
    $("recipients").value = currentDetail.modtagere || "";
    $("message").value = currentDetail.besked || "";
    if (currentDetail.fra) $("from").value = currentDetail.fra;
    $("testMode").checked = true;
    closeDetail();
    recalc();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Opstart ───────────────────────────────────────────────────────────────
  async function init() {
    try {
      const me = await fetch("/.auth/me", { cache: "no-store" }).then(r => r.ok ? r.json() : null);
      $("userLine").textContent = me?.clientPrincipal?.userDetails || "Ikke logget ind";
    } catch {
      $("userLine").textContent = "";
    }

    // Adgang afgøres af serveren (samme roller som API'et bruger).
    try {
      await loadHistory();
    } catch (e) {
      if (e.status === 401 || e.status === 403) { $("noAccess").hidden = false; return; }
    }
    $("app").hidden = false;

    ["recipients", "message", "from"].forEach(id => $(id).addEventListener("input", recalc));
    $("testMode").addEventListener("change", recalc);
    $("sendBtn").addEventListener("click", send);
    $("resetBtn").addEventListener("click", reset);
    $("balanceBtn").addEventListener("click", e => { e.preventDefault(); loadBalance(); });

    $("histSearch").addEventListener("input", renderHistory);
    $("histSearchX").addEventListener("click", () => { $("histSearch").value = ""; renderHistory(); });
    $("histHideTest").addEventListener("change", renderHistory);
    $("histReload").addEventListener("click", () => loadHistory().catch(() => {}));
    $("histAll").addEventListener("change", () => loadHistory().catch(() => {}));

    $("selfBtn").addEventListener("click", sendSelf);
    $("aiBtn").addEventListener("click", checkWithAi);
    $("aiClose").addEventListener("click", closeAi);
    $("aiClose2").addEventListener("click", closeAi);
    $("aiApproveAll").addEventListener("click", approveAllAi);
    $("aiOverlay").addEventListener("click", e => { if (e.target === $("aiOverlay")) closeAi(); });

    $("orderLink").addEventListener("click", openOrder);
    $("orderClose").addEventListener("click", closeOrder);
    $("orderClose2").addEventListener("click", closeOrder);
    $("orderSend").addEventListener("click", sendOrder);
    $("orderCount").addEventListener("input", updateOrderPrice);
    $("orderCount").addEventListener("keydown", e => { if (e.key === "Enter") sendOrder(); });
    $("orderOverlay").addEventListener("click", e => { if (e.target === $("orderOverlay")) closeOrder(); });

    $("detailClose").addEventListener("click", closeDetail);
    $("detailClose2").addEventListener("click", closeDetail);
    $("detailReuse").addEventListener("click", reuseDetail);
    $("detailOverlay").addEventListener("click", e => { if (e.target === $("detailOverlay")) closeDetail(); });
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (!$("detailOverlay").hidden) closeDetail();
      if (!$("aiOverlay").hidden) closeAi();
      if (!$("orderOverlay").hidden) closeOrder();
    });


    recalc();
    loadBalance();
    loadMe();
  }

  init();
})();
