// assets/sms.js – SMS service (SMS.html)
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  let PRICE = 0.37;
  let history = [];
  let currentDetail = null;

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
    return { length: len, parts, gsm, odd: [...odd] };
  }

  // ── Send SMS ──────────────────────────────────────────────────────────────
  function recalc() {
    const nums = parseNumbers($("recipients").value);
    const info = smsInfo($("message").value.trim());
    const total = nums.valid.length * info.parts;

    $("recCount").textContent = nums.valid.length;
    $("msgLen").textContent = info.length;
    $("msgParts").textContent = info.parts;
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
    btn.disabled = !nums.valid.length || !info.parts || info.parts > 6 || !$("from").value.trim();
    return { nums, info, total, test };
  }

  async function send() {
    const { nums, total, test } = recalc();
    if (!test) {
      const ok = confirm(`Send ${total} SMS'er til ${nums.valid.length} modtagere?\n\nPris ca. ${kr(total * PRICE)}`);
      if (!ok) return;
    }
    const btn = $("sendBtn");
    btn.disabled = true;
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
      $("sendMsg").textContent = "";
      recalc();
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
      const r = await api("/api/sms-log?top=500");
      history = r.items || [];
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

  // ── Migrering (kun admin) ─────────────────────────────────────────────────
  function migLog(line) {
    const el = $("migLog");
    el.textContent += (el.textContent ? "\n" : "") + `[${new Date().toLocaleTimeString("da-DK")}] ${line}`;
    el.scrollTop = el.scrollHeight;
  }

  async function migCheck() {
    $("migCheck").disabled = true;
    $("migStatus").textContent = "Tjekker…";
    try {
      const r = await api("/api/sms-migrate");
      migLog(`SharePoint: ${r.total} rækker · allerede flyttet: ${r.alreadyMigrated} · mangler: ${r.remaining}`);
      if (r.sample && r.sample.length) migLog("Eksempel på første række:\n" + JSON.stringify(r.sample[0], null, 2));
      $("migStatus").textContent = r.remaining ? `${r.remaining} rækker klar til flytning` : "Alt er flyttet";
      $("migRun").disabled = !r.remaining;
    } catch (e) {
      migLog("FEJL: " + e.message);
      $("migStatus").textContent = "Fejl – se log";
    } finally {
      $("migCheck").disabled = false;
    }
  }

  async function migRun() {
    if (!confirm("Start flytning af historik fra SharePoint til Dataverse?")) return;
    $("migRun").disabled = true;
    $("migCheck").disabled = true;
    let totalMigrated = 0, totalFailed = 0, rounds = 0, lastRemaining = Infinity;
    try {
      while (rounds < 100) {
        rounds++;
        $("migStatus").textContent = `Kører runde ${rounds}…`;
        const r = await api("/api/sms-migrate", { method: "POST", body: { limit: 150 } });
        totalMigrated += r.migrated;
        totalFailed = r.failed.length;
        migLog(`Runde ${rounds}: flyttet ${r.migrated}, fejlet ${r.failed.length}, mangler ${r.remaining}`);
        r.failed.slice(0, 5).forEach(f => migLog(`  SharePoint-ID ${f.spId}: ${f.error}`));
        const left = r.remaining + r.failed.length;
        // Stop når alt er flyttet, eller hvis intet flyttes (kun fejl tilbage)
        if (r.remaining <= 0 || r.migrated === 0 || left >= lastRemaining) break;
        lastRemaining = left;
      }
      migLog(`Færdig: ${totalMigrated} rækker flyttet${totalFailed ? `, ${totalFailed} fejlede (kan køres igen)` : ""}.`);
      $("migStatus").textContent = totalFailed ? "Færdig med fejl – se log" : "Færdig";
      loadHistory();
    } catch (e) {
      migLog("FEJL: " + e.message);
      $("migStatus").textContent = "Stoppet – se log";
    } finally {
      $("migCheck").disabled = false;
    }
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
    let first;
    try {
      first = await loadHistory();
    } catch (e) {
      if (e.status === 401 || e.status === 403) { $("noAccess").hidden = false; return; }
      first = null;
    }
    $("app").hidden = false;
    if (first?.isAdmin) $("migrateSection").hidden = false;

    ["recipients", "message", "from"].forEach(id => $(id).addEventListener("input", recalc));
    $("testMode").addEventListener("change", recalc);
    $("sendBtn").addEventListener("click", send);
    $("resetBtn").addEventListener("click", reset);
    $("balanceBtn").addEventListener("click", e => { e.preventDefault(); loadBalance(); });

    $("histSearch").addEventListener("input", renderHistory);
    $("histSearchX").addEventListener("click", () => { $("histSearch").value = ""; renderHistory(); });
    $("histHideTest").addEventListener("change", renderHistory);
    $("histReload").addEventListener("click", () => loadHistory().catch(() => {}));

    $("detailClose").addEventListener("click", closeDetail);
    $("detailClose2").addEventListener("click", closeDetail);
    $("detailReuse").addEventListener("click", reuseDetail);
    $("detailOverlay").addEventListener("click", e => { if (e.target === $("detailOverlay")) closeDetail(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("detailOverlay").hidden) closeDetail(); });

    $("migCheck").addEventListener("click", migCheck);
    $("migRun").addEventListener("click", migRun);

    recalc();
    loadBalance();
  }

  init();
})();
