async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) throw { status: r.status, data };
  return data;
}

function $(id){ return document.getElementById(id); }
function escapeHtml(value){ return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"}[c])); }

let lastRows = [];
let sortCol = "sort";
let sortDir = 1; // 1 = asc, -1 = desc

function uniq(arr) {
  return Array.from(new Set((arr||[]).filter(Boolean).map(x => String(x).trim())))
    .sort((a,b)=>a.localeCompare(b, "da"));
}

function setSelectOptions(selectEl, options, { includeEmpty=true, emptyText="(ingen)" } = {}) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  if (includeEmpty) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = emptyText;
    selectEl.appendChild(o);
  }
  (options||[]).forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    selectEl.appendChild(o);
  });
}

function updateIconPreview() {
  const v = $("icon")?.value?.trim() || "";
  const p = $("iconPreview");
  if (!p) return;

  const isImg =
    /^data:image\//i.test(v) ||
    /^https?:\/\//i.test(v) ||
    v.startsWith("/") ||
    /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(v);

  if (isImg && v) {
    p.innerHTML = `<img src="${v}" alt="" style="height:28px; width:28px; object-fit:contain; vertical-align:middle;">`;
  } else {
    p.textContent = v || "🔗";
  }
}

function updateFavVisibility() {
  const cat = ($("category")?.value || "").trim().toLowerCase();
  const isFav = cat === "lely favoritter";

  const groupRow = $("groupRow");
  const subgroupRow = $("subgroupRow");

  if (groupRow) groupRow.style.display = isFav ? "" : "none";
  if (subgroupRow) subgroupRow.style.display = isFav ? "" : "none";

  if (!isFav) {
    if ($("group")) $("group").value = "";
    if ($("subgroup")) $("subgroup").value = "";
  }

  if (isFav && !($("id")?.value || "").trim()) $("sort").value = "";
}

function readForm() {
  const category = $("category").value || "";
  const isFav = category.trim().toLowerCase() === "lely favoritter";

  const primaer = $("primaer1")?.checked ? 1 : ($("primaer2")?.checked ? 2 : null);

  return {
    id: $("id").value || null,
    title: $("title").value.trim(),
    url: $("url").value.trim(),
    description: $("description")?.value.trim() || "",
    category,
    group: isFav ? ($("group").value || "") : "",
    subgroup: isFav ? ($("subgroup")?.value || "").trim() : "",
    icon: $("icon").value.trim(),
    allowedRoles: $("roles").value.trim(),
    enabled: $("enabled").checked,
    sort: Number($("sort").value || 100),
    openMode: $("openMode").value,
    platformHint: $("platformHint")?.value || "All",
    primaer
  };
}

function fillForm(x) {
  $("id").value = x?.id || "";
  $("title").value = x?.title || "";
  $("url").value = x?.url || "";
  if ($("description")) $("description").value = x?.description || x?.forklaring || "";
  $("category").value = x?.category || "";
  $("group").value = x?.group || "";
  if ($("subgroup")) $("subgroup").value = x?.subgroup || "";
  $("icon").value = x?.icon || "";
  updateIconPreview();
  $("roles").value = Array.isArray(x?.allowedRoles) ? x.allowedRoles.join(";") : (x?.allowedRoles || "");
  $("enabled").checked = x?.enabled !== false;
  $("sort").value = x?.sort ?? 100;
  $("openMode").value = x?.openMode || "newTab";
  if ($("platformHint")) $("platformHint").value = x?.platformHint || "All";
  if ($("primaer1")) $("primaer1").checked = x?.primaer === 1;
  if ($("primaer2")) $("primaer2").checked = x?.primaer === 2;
  updateFavVisibility();
  maybeAutoSort();
}

function resetForm() {
  // Nyt link: Ikon-feltet foreslås forudfyldt med "/icons/", da alle ikoner
  // ligger i den mappe — så skal man kun skrive filnavnet selv.
  fillForm({ enabled:true, sort:100, openMode:"newTab", platformHint:"All", subgroup:"", icon:"/icons/" });
  $("msg").textContent = "";
}

function seedPickersNow() {
  setSelectOptions($("category"),
    ["Web Apps","Lely favoritter","Værktøjer","PowerApps","Andet"],
    { includeEmpty:true, emptyText:"(vælg kategori)" }
  );

  setSelectOptions($("subgroup"),
    ["Dokumentation"],
    { includeEmpty:true, emptyText:"(ingen undergruppe)" }
  );

  setSelectOptions($("group"),
    ["Lely","Salg","Tekniker","FMS","Administration"],
    { includeEmpty:true, emptyText:"(ingen gruppe)" }
  );

  setSelectOptions($("platformHint"),
    ["All","Desktop","Mobile"],
    { includeEmpty:false }
  );

  const fixedIcons = ["🔗","🧩","🐄","🪑","📄","📊","⚙️","🧰","🧑‍💼","📱","🗂️","🌐","🏷️"];
  const dl = document.getElementById("iconList");
  if (dl) {
    dl.innerHTML = "";
    fixedIcons.forEach(ic => {
      const opt = document.createElement("option");
      opt.value = ic;
      dl.appendChild(opt);
    });
  }

  updateFavVisibility();
}

function buildPickers(rows) {
  const cats = uniq(["Web Apps","Lely favoritter","Værktøjer","PowerApps","Andet", ...rows.map(r => r.category)]);
  setSelectOptions($("category"), cats, { includeEmpty:true, emptyText:"(vælg kategori)" });

  const subs = uniq([
    "Dokumentation",
    ...rows
      .filter(r => (r.category || "").toLowerCase() === "lely favoritter")
      .map(r => r.subgroup)
  ]);
  setSelectOptions($("subgroup"), subs, { includeEmpty:true, emptyText:"(ingen undergruppe)" });

  const grps = uniq([
    "Lely","Salg","Tekniker","FMS","Administration",
    ...rows.filter(r => (r.category || "").toLowerCase() === "lely favoritter").map(r => r.group)
  ]);
  setSelectOptions($("group"), grps, { includeEmpty:true, emptyText:"(ingen gruppe)" });

  const hints = uniq(["All","Desktop","Mobile", ...rows.map(r => r.platformHint)]);
  setSelectOptions($("platformHint"), hints, { includeEmpty:false });

  updateFavVisibility();
}

// ---- Søg og sortér ----

function getFilteredSorted() {
  const q = ($("tableSearch")?.value || "").toLowerCase().trim();
  const filterCat = $("tableFilterCat")?.value || "";
  const filterEnabled = $("tableFilterEnabled")?.value || "";

  let rows = lastRows.filter(x => {
    if (filterCat && x.category !== filterCat) return false;
    if (filterEnabled === "ja" && x.enabled === false) return false;
    if (filterEnabled === "nej" && x.enabled !== false) return false;
    if (!q) return true;
    return (
      (x.title || "").toLowerCase().includes(q) ||
      (x.url || "").toLowerCase().includes(q) ||
      (x.description || x.forklaring || "").toLowerCase().includes(q) ||
      (x.category || "").toLowerCase().includes(q) ||
      (x.group || "").toLowerCase().includes(q) ||
      (x.allowedRoles || "").toLowerCase().includes(q)
    );
  });

  rows = rows.slice().sort((a, b) => {
    let av, bv;
    if (sortCol === "sort") {
      av = a.sort ?? 1000;
      bv = b.sort ?? 1000;
      return (av - bv) * sortDir;
    }
    av = String(a[sortCol] ?? "").toLowerCase();
    bv = String(b[sortCol] ?? "").toLowerCase();
    return av.localeCompare(bv, "da") * sortDir;
  });

  return rows;
}

function updateSortHeaders() {
  document.querySelectorAll("#tbl thead th[data-col]").forEach(th => {
    const col = th.getAttribute("data-col");
    th.classList.toggle("sort-active", col === sortCol);
    const arrow = th.querySelector(".sort-arrow");
    if (arrow) {
      arrow.textContent = col === sortCol ? (sortDir === 1 ? " ▲" : " ▼") : " ⇅";
    }
  });
}

function renderTable(rows) {
  const tb = $("tbl").querySelector("tbody");
  tb.innerHTML = "";

  const $count = $("tableCount");
  if ($count) $count.textContent = `${rows.length} rækker`;

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="10" style="text-align:center;color:#6b7280;padding:1.5rem">Ingen resultater</td>`;
    tb.appendChild(tr);
    return;
  }

  rows.forEach(x => {
    const primaerDisplay = (x.primaer === 1 || x.primaer === 2) ? String(x.primaer) : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${x.title || ""}</td>
      <td>${x.description || x.forklaring || ""}</td>
      <td>${x.category || ""}</td>
      <td>${x.group || ""}</td>
      <td>${x.subgroup || ""}</td>
      <td>${x.platformHint || ""}</td>
      <td style="text-align:center">${primaerDisplay}</td>
      <td>${x.enabled !== false ? "Ja" : "Nej"}</td>
      <td>${Array.isArray(x.allowedRoles) ? x.allowedRoles.join(";") : (x.allowedRoles || "")}</td>
      <td style="white-space:nowrap">
        <button class="btn" data-act="edit">Redigér</button>
        <button class="btn" data-act="del">Slet</button>
      </td>
    `;

    tr.querySelector('[data-act="edit"]').onclick = () => {
      fillForm(x);
      const form = $("form");
      if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $("title")?.focus(), 150);
    };

    tr.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`Slet "${x.title}"?`)) return;
      await api("DELETE", `/api/links-admin?id=${encodeURIComponent(x.id)}`);
      await refresh();
      resetForm();
    };
    tb.appendChild(tr);
  });
}

function applyTableFilters() {
  renderTable(getFilteredSorted());
}

function maybeAutoSort() {
  if (($("id")?.value || "").trim()) return;

  const cat = ($("category")?.value || "").trim().toLowerCase();
  if (cat !== "lely favoritter") return;

  const grp = ($("group")?.value || "").trim();
  if (!grp) return;

  const sub = ($("subgroup")?.value || "").trim();

  const cur = String($("sort")?.value || "").trim();
  if (cur && cur !== "0") return;

  const maxSort = Math.max(
    0,
    ...lastRows
      .filter(r => (r.category || "").toLowerCase() === "lely favoritter")
      .filter(r => (r.group || "").trim() === grp)
      .filter(r => String(r.subgroup || "").trim() === sub)
      .map(r => Number(r.sort ?? 0))
      .filter(n => Number.isFinite(n))
  );

  $("sort").value = String(maxSort + 10);
}

async function refresh() {
  const rows = await api("GET", "/api/links-admin");
  lastRows = rows || [];
  buildPickers(lastRows);
  updateSortHeaders();
  applyTableFilters();
  maybeAutoSort();
}

(async function init(){
  seedPickersNow();

  $("icon").addEventListener("input", updateIconPreview);
  updateIconPreview();

  $("category").addEventListener("change", () => {
    updateFavVisibility();
    maybeAutoSort();
  });

  $("group").addEventListener("change", maybeAutoSort);
  if ($("subgroup")) $("subgroup").addEventListener("change", maybeAutoSort);

  // Kun ét af de to primær-felter kan være markeret på samme link (feltet
  // i Dataverse kan kun holde én værdi: 1, 2 eller ingen).
  $("primaer1")?.addEventListener("change", () => {
    if ($("primaer1").checked && $("primaer2")) $("primaer2").checked = false;
  });
  $("primaer2")?.addEventListener("change", () => {
    if ($("primaer2").checked && $("primaer1")) $("primaer1").checked = false;
  });

  // Tabel: søg og filtre
  $("tableSearch")?.addEventListener("input", applyTableFilters);
  $("tableFilterCat")?.addEventListener("change", applyTableFilters);
  $("tableFilterEnabled")?.addEventListener("change", applyTableFilters);

  $("tableClearSearch")?.addEventListener("click", () => {
    if ($("tableSearch")) $("tableSearch").value = "";
    applyTableFilters();
  });

  // Sorterbare kolonner
  document.querySelectorAll("#tbl thead th[data-col]").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-col");
      if (sortCol === col) {
        sortDir *= -1;
      } else {
        sortCol = col;
        sortDir = 1;
      }
      updateSortHeaders();
      applyTableFilters();
    });
  });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("msg").textContent = "Gemmer...";
    const x = readForm();

    try {
      if (x.id) await api("PUT", "/api/links-admin", x);
      else await api("POST", "/api/links-admin", x);

      $("msg").textContent = "Gemt ✅";
      await refresh();
      resetForm();
    } catch (err) {
      $("msg").textContent =
        `Fejl (${err?.status || "?"}): ` + (err?.data?.message || JSON.stringify(err?.data || err));
      console.warn("save fejl:", err);
    }
  });

  $("resetBtn").addEventListener("click", resetForm);

  resetForm();

  try {
    await refresh();
  } catch (err) {
    $("msg").textContent = `API /api/links-admin virker ikke endnu. Fejl (${err?.status || "?"}).`;
    console.warn("refresh() fejlede:", err);
  }

  initTipPopup();
})();

// ── Nyhed/tip administration ────────────────────────────────────────────────
function initTipPopup() {
  const overlay = $("tipOverlay");
  if (!overlay) return;

  let tipRows = [];

  function updateTipUdlobVisibility() {
    const isNyhed = $("tipValgNyhed").checked;
    $("tipUdlobRow").style.display = isNyhed ? "" : "none";
    if (!isNyhed) $("tipUdlobsdato").value = "";
  }

  function resetTipForm() {
    $("tipForm").reset();
    $("tipId").value = "";
    $("tipValgNyhed").checked = true;
    $("tipAktiv").checked = true;
    $("tipModalTitle").textContent = "Ny nyhed/tip";
    $("tipSaveBtn").textContent = "Gem";
    $("tipMsg").textContent = "";
    updateTipUdlobVisibility();
    document.querySelectorAll("#tipListBody tr").forEach(tr => tr.classList.remove("tipRowSelected"));
  }

  function fillTipForm(row) {
    if (!row) return;
    $("tipId").value = row.id || "";
    $("tipOverskrift").value = row.overskrift || "";
    $("tipIndhold").value = row.indhold || "";
    $("tipValgNyhed").checked = row.valg === "Nyhed";
    $("tipValgTip").checked = row.valg === "Tip";
    $("tipUdlobsdato").value = row.udlobsdato || "";
    $("tipAktiv").checked = row.aktiv !== false;
    $("tipModalTitle").textContent = "Rediger nyhed/tip";
    $("tipSaveBtn").textContent = "Gem ændringer";
    $("tipMsg").textContent = "";
    updateTipUdlobVisibility();
  }

  function shortText(value, max = 100) {
    const t = String(value || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }

  function renderTipList() {
    const body = $("tipListBody");
    if (!body) return;
    body.innerHTML = "";
    $("tipListCount").textContent = `${tipRows.length} stk.`;

    if (!tipRows.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted">Ingen nyheder eller tips fundet.</td></tr>';
      return;
    }

    tipRows.forEach(row => {
      const tr = document.createElement("tr");
      tr.dataset.id = row.id;
      tr.innerHTML = `
        <td>${row.valg === "Nyhed" ? "📢 Nyhed" : "💡 Tip"}</td>
        <td><strong>${escapeHtml(row.overskrift || "(ingen overskrift)")}</strong></td>
        <td title="${escapeHtml(row.indhold || "")}">${escapeHtml(shortText(row.indhold))}</td>
        <td>${escapeHtml(row.udlobsdato || "-")}</td>
        <td><span class="tipStatus ${row.aktiv ? "on" : "off"}">${row.aktiv ? "Aktiv" : "Inaktiv"}</span></td>`;
      tr.addEventListener("click", () => {
        document.querySelectorAll("#tipListBody tr").forEach(x => x.classList.remove("tipRowSelected"));
        tr.classList.add("tipRowSelected");
        fillTipForm(row);
        $("tipOverskrift")?.focus();
      });
      body.appendChild(tr);
    });
  }

  async function loadTipList() {
    const body = $("tipListBody");
    if (body) body.innerHTML = '<tr><td colspan="5" class="muted">Henter...</td></tr>';
    try {
      const data = await api("GET", "/api/tips-admin");
      tipRows = Array.isArray(data?.items) ? data.items : [];
      renderTipList();
      if (data?.headingSupported === false) {
        $("tipMsg").textContent = "Bemærk: Dataverse-feltet cr175_lch_overskrift findes ikke endnu.";
      }
    } catch (err) {
      tipRows = [];
      if (body) body.innerHTML = `<tr><td colspan="5">Fejl: ${escapeHtml(err?.data?.message || JSON.stringify(err?.data || err))}</td></tr>`;
    }
  }

  async function openTipPopup() {
    resetTipForm();
    overlay.style.display = "flex";
    await loadTipList();
    setTimeout(() => $("tipOverskrift")?.focus(), 50);
  }

  function closeTipPopup() {
    overlay.style.display = "none";
  }

  $("newTipLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    openTipPopup();
  });
  $("tipCloseBtn")?.addEventListener("click", closeTipPopup);
  $("tipCancelBtn")?.addEventListener("click", closeTipPopup);
  $("tipNewBtn")?.addEventListener("click", resetTipForm);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTipPopup(); });
  $("tipValgNyhed")?.addEventListener("change", updateTipUdlobVisibility);
  $("tipValgTip")?.addEventListener("change", updateTipUdlobVisibility);

  $("tipForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const indhold = $("tipIndhold").value.trim();
    if (!indhold) {
      $("tipMsg").textContent = "Indhold er påkrævet.";
      return;
    }

    const payload = {
      id: $("tipId").value || undefined,
      overskrift: $("tipOverskrift").value.trim(),
      indhold,
      valg: $("tipValgNyhed").checked ? "Nyhed" : "Tip",
      udlobsdato: $("tipValgNyhed").checked ? ($("tipUdlobsdato").value || null) : null,
      aktiv: $("tipAktiv").checked
    };

    $("tipMsg").textContent = "Gemmer...";
    try {
      const data = await api(payload.id ? "PUT" : "POST", "/api/tips-admin", payload);
      $("tipMsg").textContent = data?.headingSupported === false
        ? "Gemt, men overskrift-feltet mangler i Dataverse."
        : "Gemt ✅";
      await loadTipList();
      if (!payload.id) resetTipForm();
      else {
        const updated = tipRows.find(x => x.id === payload.id);
        if (updated) fillTipForm(updated);
      }
    } catch (err) {
      $("tipMsg").textContent = `Fejl (${err?.status || "?"}): ` + (err?.data?.message || JSON.stringify(err?.data || err));
      console.warn("tip save fejl:", err);
    }
  });
}
