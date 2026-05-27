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
  const isFav = cat === "favoritter";

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
  const isFav = category.trim().toLowerCase() === "favoritter";

  return {
    id: $("id").value || null,
    title: $("title").value.trim(),
    url: $("url").value.trim(),
    category,
    group: isFav ? ($("group").value || "") : "",
    subgroup: isFav ? ($("subgroup")?.value || "").trim() : "",
    parent: $("parent").value || null,
    icon: $("icon").value.trim(),
    allowedRoles: $("roles").value.trim(),
    enabled: $("enabled").checked,
    sort: Number($("sort").value || 100),
    openMode: $("openMode").value,
    platformHint: $("platformHint")?.value || "All"
  };
}

function fillForm(x) {
  $("id").value = x?.id || "";
  $("title").value = x?.title || "";
  $("url").value = x?.url || "";
  $("category").value = x?.category || "";
  $("group").value = x?.group || "";
  if ($("subgroup")) $("subgroup").value = x?.subgroup || "";
  $("parent").value = x?.parent || "";
  $("icon").value = x?.icon || "";
  updateIconPreview();
  $("roles").value = Array.isArray(x?.allowedRoles) ? x.allowedRoles.join(";") : (x?.allowedRoles || "");
  $("enabled").checked = x?.enabled !== false;
  $("sort").value = x?.sort ?? 100;
  $("openMode").value = x?.openMode || "newTab";
  if ($("platformHint")) $("platformHint").value = x?.platformHint || "All";
  updateFavVisibility();
  maybeAutoSort();
}

function resetForm() {
  fillForm({ enabled:true, sort:100, openMode:"newTab", platformHint:"All", subgroup:"" });
  $("msg").textContent = "";
}

function seedPickersNow() {
  setSelectOptions($("category"),
    ["Web Apps","Favoritter","Værktøjer","PowerApps","Andet"],
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

  const p = $("parent");
  if (p) p.innerHTML = `<option value="">(ingen parent)</option>`;

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
  const cats = uniq(["Web Apps","Favoritter","Værktøjer","PowerApps","Andet", ...rows.map(r => r.category)]);
  setSelectOptions($("category"), cats, { includeEmpty:true, emptyText:"(vælg kategori)" });

  const subs = uniq([
    "Dokumentation",
    ...rows
      .filter(r => (r.category || "").toLowerCase() === "favoritter")
      .map(r => r.subgroup)
  ]);
  setSelectOptions($("subgroup"), subs, { includeEmpty:true, emptyText:"(ingen undergruppe)" });

  const grps = uniq([
    "Lely","Salg","Tekniker","FMS","Administration",
    ...rows.filter(r => (r.category || "").toLowerCase() === "favoritter").map(r => r.group)
  ]);
  setSelectOptions($("group"), grps, { includeEmpty:true, emptyText:"(ingen gruppe)" });

  const hints = uniq(["All","Desktop","Mobile", ...rows.map(r => r.platformHint)]);
  setSelectOptions($("platformHint"), hints, { includeEmpty:false });

  const parentCandidates = rows.filter(r => !r.url).map(r => ({ id:r.id, title:r.title }));
  const parentSelect = $("parent");
  parentSelect.innerHTML = `<option value="">(ingen parent)</option>`;
  parentCandidates.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.title;
    parentSelect.appendChild(o);
  });

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
  const byId = new Map(lastRows.map(r => [r.id, r]));
  const tb = $("tbl").querySelector("tbody");
  tb.innerHTML = "";

  const $count = $("tableCount");
  if ($count) $count.textContent = `${rows.length} rækker`;

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" style="text-align:center;color:#6b7280;padding:1.5rem">Ingen resultater</td>`;
    tb.appendChild(tr);
    return;
  }

  rows.forEach(x => {
    const parentTitle = x.parent ? (byId.get(x.parent)?.title || x.parent) : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${x.title || ""}</td>
      <td>${x.category || ""}</td>
      <td>${x.group || ""}</td>
      <td>${x.subgroup || ""}</td>
      <td>${x.platformHint || ""}</td>
      <td>${parentTitle}</td>
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
  if (cat !== "favoritter") return;

  const grp = ($("group")?.value || "").trim();
  if (!grp) return;

  const sub = ($("subgroup")?.value || "").trim();

  const cur = String($("sort")?.value || "").trim();
  if (cur && cur !== "0") return;

  const maxSort = Math.max(
    0,
    ...lastRows
      .filter(r => (r.category || "").toLowerCase() === "favoritter")
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
})();
