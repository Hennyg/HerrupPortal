(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  let allDebtors = [];
  let currentRawData = null;
  let showingAllData = false;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  async function readJsonResponse(response) {
    const text = await response.text();

    if (!text) {
      throw new Error(`API returnerede et tomt svar. HTTP ${response.status}.`);
    }

    try {
      return JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, " ").slice(0, 500);
      throw new Error(
        `API returnerede ikke gyldig JSON. HTTP ${response.status}: ${preview}`
      );
    }
  }

  function setStatus(type, message) {
    const element = $("status");
    element.className = `status ${type || ""}`.trim();

    if (type === "loading") {
      element.innerHTML = `<div class="spinner"></div>${escapeHtml(message)}`;
    } else {
      element.textContent = message;
    }

    element.style.display = message ? "flex" : "none";
  }

  function render(rows) {
    const body = $("debtorBody");

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">Ingen debitorer fundet.</td></tr>';
    } else {
      body.innerHTML = rows.map(debtor => `
        <tr>
          <td class="small muted">${escapeHtml(debtor.account)}</td>
          <td>${escapeHtml(debtor.name)}</td>
          <td>${escapeHtml(debtor.address1)}</td>
          <td>${escapeHtml(debtor.zipCode)}</td>
          <td>${escapeHtml(debtor.city)}</td>
          <td>
            <button
              class="btn js-show"
              type="button"
              data-account="${escapeAttribute(debtor.account)}"
            >Vis</button>
          </td>
        </tr>
      `).join("");
    }

    $("countText").textContent = `${rows.length} af ${allDebtors.length} debitorer`;
    $("tableWrap").classList.remove("hidden");
    setStatus("", "");
  }

  function filterRows() {
    const query = $("searchInput").value.trim().toLocaleLowerCase("da-DK");

    if (!query) {
      render(allDebtors);
      return;
    }

    const filtered = allDebtors.filter(debtor =>
      [
        debtor.account,
        debtor.name,
        debtor.address1,
        debtor.zipCode,
        debtor.city
      ].some(value =>
        String(value || "").toLocaleLowerCase("da-DK").includes(query)
      )
    );

    render(filtered);
  }

  async function loadDebtors() {
    $("tableWrap").classList.add("hidden");
    $("countText").textContent = "";
    setStatus("loading", "Henter debitorer fra Uniconta...");

    try {
      const response = await fetch("/api/uniconta/debtors", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });

      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message ||
          data?.error ||
          `Kunne ikke hente debitorer. HTTP ${response.status}.`
        );
      }

      allDebtors = Array.isArray(data?.debtors) ? data.debtors : [];
      filterRows();
    } catch (error) {
      allDebtors = [];
      $("countText").textContent = "";
      setStatus("error", error?.message || "Ukendt fejl ved hentning af debitorer.");
    }
  }

  function detailRow(label, value) {
    let displayedValue = value;

    if (value === true) displayedValue = "Ja";
    if (value === false) displayedValue = "Nej";
    if (value === null || value === undefined || value === "") displayedValue = "—";

    return `
      <div class="detailLabel">${escapeHtml(label)}</div>
      <div>${escapeHtml(displayedValue)}</div>
    `;
  }

  function formatRawValue(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Ja" : "Nej";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function renderRawData(raw) {
    if (!raw || typeof raw !== "object") {
      return '<div class="muted">Ingen yderligere data tilgængelig.</div>';
    }

    const keys = Object.keys(raw)
      .filter(key => !key.startsWith("@"))
      .sort((a, b) => a.localeCompare(b, "da-DK"));

    if (!keys.length) {
      return '<div class="muted">Ingen yderligere data tilgængelig.</div>';
    }

    return keys.map(key => `
      <div class="detailLabel">${escapeHtml(key)}</div>
      <div>${escapeHtml(formatRawValue(raw[key]))}</div>
    `).join("");
  }

  function resetRawDataView() {
    showingAllData = false;
    currentRawData = null;
    $("rawDataWrap").classList.add("hidden");
    $("rawDataGrid").innerHTML = "";
    $("detailModal").querySelector(".modalCard").classList.remove("modalCard--wide");
    $("showAllDataBtn").textContent = "Vis alle data";
  }

  function toggleAllData() {
    showingAllData = !showingAllData;

    const wrap = $("rawDataWrap");
    const card = $("detailModal").querySelector(".modalCard");
    const button = $("showAllDataBtn");

    if (showingAllData) {
      $("rawDataGrid").innerHTML = renderRawData(currentRawData);
      wrap.classList.remove("hidden");
      card.classList.add("modalCard--wide");
      button.textContent = "Skjul alle data";
    } else {
      wrap.classList.add("hidden");
      card.classList.remove("modalCard--wide");
      button.textContent = "Vis alle data";
    }
  }

  function showDetailStatus(type, message) {
    const element = $("detailStatus");
    element.className = `status ${type || ""}`.trim();

    if (type === "loading") {
      element.innerHTML = `<div class="spinner"></div>${escapeHtml(message)}`;
    } else {
      element.textContent = message;
    }

    element.style.display = message ? "flex" : "none";
  }

  async function showDetail(account) {
    $("detailModal").classList.remove("hidden");
    $("detailGrid").classList.add("hidden");
    $("detailGrid").innerHTML = "";
    $("detailTitle").textContent = "Debitor";
    $("detailAccount").textContent = account ? `Debitornr. ${account}` : "";
    resetRawDataView();
    showDetailStatus("loading", "Henter detaljer...");

    try {
      const response = await fetch(
        `/api/uniconta/debtors/${encodeURIComponent(account)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store"
        }
      );

      const data = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(
          data?.message ||
          data?.error ||
          `Kunne ikke hente debitoren. HTTP ${response.status}.`
        );
      }

      const debtor = data?.debtor;
      if (!debtor) throw new Error("API-svaret indeholder ingen debitor.");

      currentRawData = debtor.raw || null;

      $("detailTitle").textContent = debtor.name || "Debitor";
      $("detailAccount").textContent = `Debitornr. ${debtor.account || "—"}`;
      $("detailGrid").innerHTML = [
        detailRow("Adresse", [debtor.address1, debtor.address2].filter(Boolean).join(", ")),
        detailRow("Postnr. og by", [debtor.zipCode, debtor.city].filter(Boolean).join(" ")),
        detailRow("Land", debtor.country),
        detailRow("Telefon", debtor.phone),
        detailRow("Mobil", debtor.mobile),
        detailRow("E-mail", debtor.email),
        detailRow("Kontaktperson", debtor.contactPerson),
        detailRow("CVR-nr.", debtor.vatNumber),
        detailRow("Valuta", debtor.currency),
        detailRow("Betaling", debtor.payment),
        detailRow("Spærret", debtor.blocked)
      ].join("");

      showDetailStatus("", "");
      $("detailGrid").classList.remove("hidden");
    } catch (error) {
      showDetailStatus("error", error?.message || "Ukendt fejl ved hentning af debitor.");
    }
  }

  function closeModal() {
    $("detailModal").classList.add("hidden");
    resetRawDataView();
  }

  document.addEventListener("click", event => {
    const button = event.target.closest(".js-show");
    if (button) showDetail(button.dataset.account);
    if (event.target === $("detailModal")) closeModal();
  });

  $("searchInput").addEventListener("input", filterRows);
  $("reloadBtn").addEventListener("click", loadDebtors);
  $("closeModalBtn").addEventListener("click", closeModal);
  $("showAllDataBtn").addEventListener("click", toggleAllData);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
  });

  if (typeof initUser === "function") initUser();
  loadDebtors();
})();



