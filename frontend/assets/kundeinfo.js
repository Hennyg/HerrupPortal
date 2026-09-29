// assets/kundeliste/kundeinfo.js
//
// Samlet kundeinfo for /kundeinfo.html?kundenr=...
// Samme opslag som admincreate.html i Kundeinfo-appen (Uniconta, Kundeliste,
// Entra ID ejere/medarbejdere) + besætningsdata fra Salmonella-appen via CHR.

(function () {
  const $ = id => document.getElementById(id);
  const kundenr = String(new URLSearchParams(location.search).get("kundenr") || "").trim();

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
    if (!r.ok) throw new Error(data?.message || data?.error || txt || `HTTP ${r.status}`);
    return data;
  }

  function show(statusId, dataId, html) {
    $(statusId).classList.add("hidden");
    $(dataId).innerHTML = html;
    $(dataId).classList.remove("hidden");
  }

  function setStatus(statusId, text) {
    $(statusId).textContent = text;
    $(statusId).classList.remove("hidden");
  }

  function row(label, value) {
    const shown = value === true ? "Ja" : value === false ? "Nej" : (String(value ?? "").trim() || "—");
    return `<div class="debtorLabel">${esc(label)}</div><div class="debtorValue">${esc(shown)}</div>`;
  }

  /* ---------- Uniconta ---------- */

  function unicontaAccount(nr) {
    return String(nr || "").trim().replace(/\s+/g, "").replace(/^00/, "");
  }

  async function loadUniconta() {
    const account = unicontaAccount(kundenr);
    if (!account) { setStatus("unicontaStatus", "Kunden har ikke et gyldigt kundenummer."); return false; }
    setStatus("unicontaStatus", `Henter Uniconta debitor ${account}…`);

    try {
      const data = await fetchJson(`/api/uniconta/debtors/${encodeURIComponent(account)}`);
      const d = data?.debtor;
      if (!d) throw new Error("Ingen debitoroplysninger returneret.");
      const ean = d.ean || d.raw?.EAN || d.raw?.Ean || "";

      show("unicontaStatus", "unicontaData", `
        <div class="debtorColumns">
          <div class="debtorGrid">
            ${row("Debitornr.", d.account)}
            ${row("Navn", d.name)}
            ${row("Adresse", [d.address1 || d.address, d.address2].filter(Boolean).join(", "))}
            ${row("Postnr. og by", [d.zipCode, d.city].filter(Boolean).join(" "))}
          </div>
          <div class="debtorGrid">
            ${row("Land", d.country)}
            ${row("Telefon", d.phone)}
            ${row("Mobil", d.mobile)}
            ${row("E-mail", d.email)}
          </div>
          <div class="debtorGrid">
            ${row("Kontaktperson", d.contactPerson)}
            ${row("CVR-nr.", d.vatNumber)}
            ${row("Valuta", d.currency)}
            ${row("Spærret", d.blocked)}
            ${row("EAN/GLN-nr.", ean || "(ingen)")}
          </div>
        </div>`);
      return true;
    } catch (e) {
      setStatus("unicontaStatus", `Kunne ikke finde Uniconta Debitor data for ${account}: ${e.message}`);
      return false;
    }
  }

  /* ---------- Kundeliste ---------- */

  function produkterPillsHtml(produkter) {
    const list = Array.isArray(produkter) ? produkter : [];
    return list.length
      ? `<div class="kundeAdresseProdukter">${list.map(p => `<span class="produktPill">${esc(p.produkt)} × ${p.antal}</span>`).join("")}</div>`
      : `<div class="muted">Ingen aktive produkter registreret.</div>`;
  }

  function adresseHtml(a) {
    const meta = [[a.postnr, a.by].filter(Boolean).join(" "), a.omraade].filter(Boolean);
    const inaktiv = a.aktiv === false ? ` <span class="muted">(inaktiv)</span>` : "";
    return `
      <div class="kundeAdresseItem">
        <div class="kundeAdresseLine">${esc(a.adresse || "—")}${inaktiv}</div>
        ${meta.length ? `<div class="muted">${esc(meta.join(" · "))}</div>` : ""}
        ${produkterPillsHtml(a.produkter)}
      </div>`;
  }

  async function loadKundeliste() {
    if (!kundenr) { setStatus("kundelisteStatus", "Kunden har ikke et gyldigt kundenummer."); return null; }
    setStatus("kundelisteStatus", `Henter kundedata for ${kundenr}…`);

    try {
      const data = await fetchJson(`/api/kunde-adresser?kundenr=${encodeURIComponent(kundenr)}`);
      const kunde = data?.kunde;
      if (!kunde) throw new Error("Ingen kundedata returneret.");
      const adresser = Array.isArray(data?.adresser) ? data.adresser : [];

      if (kunde.navn) {
        $("infoTitle").textContent = `${kunde.navn} (${kunde.kundenr})`;
        document.title = `Kundeinfo – ${kunde.navn}`;
      }

      show("kundelisteStatus", "kundelisteData", `
        <div class="debtorGrid" style="margin-bottom:14px;">
          ${row("Navn", kunde.navn)}
          ${row("Kundenummer", kunde.kundenr)}
          ${row("CHR-nr.", kunde.chr)}
          ${row("Område", kunde.omraade)}
        </div>
        ${adresser.length
          ? `<div class="kundeAdresseList">${adresser.map(adresseHtml).join("")}</div>`
          : `<div class="muted">Ingen adresser fundet.</div>`}`);
      return kunde;
    } catch (e) {
      setStatus("kundelisteStatus", `Kunne ikke hente kundedata for ${kundenr}: ${e.message}`);
      return null;
    }
  }

  /* ---------- Salmonella (CHR-external) ---------- */

  function salBadge(text) {
    const s = String(text || "").toLowerCase();
    const cls = /niveau\s*1\b/.test(s) ? "ok" : /niveau\s*2\b/.test(s) ? "warn" : /niveau\s*3\b/.test(s) ? "err" : "";
    return `<span class="badge ${cls}">${esc(text || "Ukendt")}</span>`;
  }

  function countBox(label, value) {
    const v = value === null || value === undefined || value === "" ? "—" : Number(value).toLocaleString("da-DK");
    return `<div class="herdCount"><div class="muted small">${esc(label)}</div><div class="herdCountValue">${esc(v)}</div></div>`;
  }

  function dyrHtml(list) {
    const multi = list.length > 1;
    return list.map(h => `
      ${multi ? `<div class="muted small" style="margin:6px 0 4px;">CHR ${esc(h.chr)}</div>` : ""}
      <div class="herdCounts">
        ${countBox("Kreaturer i alt", h.kreaturerIAlt)}
        ${countBox("Køer", h.koeer)}
        ${countBox("Kvier", h.kvier)}
      </div>`).join("");
  }

  function herdHtml(h) {
    const adr = [h.adresse, [h.postnr, h.by].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const sygdomme = h.sygdomme || [];
    return `
      <div class="herdItem">
        <div class="herdHead">
          <div>
            <div class="herdTitle">CHR ${esc(h.chr)}${h.navn ? ` · ${esc(h.navn)}` : ""}</div>
            ${adr ? `<div class="muted">${esc(adr)}</div>` : ""}
          </div>
          <div class="herdSal">
            <div class="muted small">Salmonella</div>
            ${salBadge(h.salmonellaStatus)}
            ${h.salmonellaDato ? `<div class="muted small" style="margin-top:4px;">${fmtDate(h.salmonellaDato)}</div>` : ""}
          </div>
        </div>
        ${sygdomme.length ? `
          <div style="overflow-x:auto;">
            <table class="herdTable">
              <thead><tr><th>Kode</th><th>Sygdom</th><th>Veterinærstatus</th><th>Dato</th></tr></thead>
              <tbody>
                ${sygdomme.map(s => `<tr>
                  <td>${esc(s.kode)}</td>
                  <td>${esc(s.sygdom || "—")}</td>
                  <td>${esc(s.status || "—")}</td>
                  <td>${s.dato ? fmtDate(s.dato) : "—"}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="muted">Ingen øvrige sygdomsstatusser registreret.</div>`}
        ${h.modifiedOn ? `<div class="muted small" style="margin-top:8px;">Opdateret ${fmtDateTime(h.modifiedOn)}</div>` : ""}
      </div>`;
  }

  async function loadSalmonella(chr) {
    const value = String(chr || "").trim();
    if (!value) {
      setStatus("dyrStatus", "Kunden har intet CHR-nummer i kundelisten.");
      setStatus("salmonellaStatus", "Kunden har intet CHR-nummer i kundelisten.");
      return false;
    }
    setStatus("dyrStatus", `Henter antal dyr for CHR ${value}…`);
    setStatus("salmonellaStatus", `Henter besætningsdata for CHR ${value}…`);

    try {
      const data = await fetchJson(`/api/kunde-salmonella?chr=${encodeURIComponent(value)}`);
      const list = Array.isArray(data?.besaetninger) ? data.besaetninger : [];
      if (!list.length) {
        setStatus("dyrStatus", `Ingen besætningsdata fundet for CHR ${value}.`);
        setStatus("salmonellaStatus", `Ingen besætningsdata fundet for CHR ${value}.`);
        return false;
      }
      show("dyrStatus", "dyrData", dyrHtml(list));
      show("salmonellaStatus", "salmonellaData", `<div class="herdList">${list.map(herdHtml).join("")}</div>`);
      return true;
    } catch (e) {
      setStatus("dyrStatus", `Kunne ikke hente antal dyr: ${e.message}`);
      setStatus("salmonellaStatus", `Kunne ikke hente salmonelladata: ${e.message}`);
      return false;
    }
  }

  /* ---------- Entra ID ---------- */

  function contactRow(label, value) {
    const v = String(value || "").trim();
    return v ? `<div class="contactLabel">${esc(label)}</div><div class="contactValue">${esc(v)}</div>` : "";
  }

  function contactHtml(c) {
    return `
      <article class="contactItem">
        <div class="contactName">${esc(c.displayName || "(uden navn)")}</div>
        <div class="contactDetails">
          ${contactRow("E-mail", c.email)}
          ${contactRow("Mobil", c.mobilePhone)}
          ${contactRow("Telefon", c.businessPhone)}
          ${contactRow("Primæradresse", c.primaerAdresse)}
          ${contactRow("2. adresse", c.adresse2)}
          ${contactRow("3. adresse", c.adresse3)}
        </div>
      </article>`;
  }

  function renderContacts(key, list, emptyText) {
    if (!list.length) { setStatus(`entra${key}Status`, emptyText); return; }
    show(`entra${key}Status`, `entra${key}List`, list.map(contactHtml).join(""));
  }

  async function loadEntra() {
    if (!kundenr) {
      setStatus("entraOwnersStatus", "Kunden har ikke et gyldigt kundenummer.");
      setStatus("entraEmployeesStatus", "Kunden har ikke et gyldigt kundenummer.");
      return false;
    }
    try {
      const data = await fetchJson(`/api/entra-customer-contacts?kundenr=${encodeURIComponent(kundenr)}`);
      const owners = Array.isArray(data?.owners) ? data.owners : [];
      const employees = Array.isArray(data?.employees) ? data.employees : [];
      renderContacts("Owners", owners, "Ingen ejere fundet i Entra ID.");
      renderContacts("Employees", employees, "Ingen medarbejdere fundet i Entra ID.");
      return owners.length > 0 || employees.length > 0;
    } catch (e) {
      const msg = `Kunne ikke hente kontakter fra Entra ID: ${e.message}`;
      setStatus("entraOwnersStatus", msg);
      setStatus("entraEmployeesStatus", msg);
      return false;
    }
  }

  /* ---------- Init ---------- */

  function wireButtons() {
    $("btnOpen").href = `/kunde.html?kundenr=${encodeURIComponent(kundenr)}`;
    const back = $("btnBack");
    if (document.referrer && document.referrer.indexOf("/kundeliste.html") !== -1) {
      back.addEventListener("click", e => { e.preventDefault(); history.back(); });
    }
  }

  async function init() {
    initUser();
    wireButtons();
    if (kundenr) $("infoTitle").textContent = `Kunde ${kundenr}`;

    const kundelistePromise = loadKundeliste();
    const salmonellaPromise = kundelistePromise.then(k => loadSalmonella(k?.chr));

    const [uniconta, kunde, entra] = await Promise.all([loadUniconta(), kundelistePromise, loadEntra()]);
    await salmonellaPromise;

    if (!uniconta && !kunde && !entra) {
      const msg = "Kunden findes ikke i systemet";
      ["unicontaStatus", "kundelisteStatus", "entraOwnersStatus", "entraEmployeesStatus"].forEach(id => setStatus(id, msg));
    }
  }

  init();
})();
