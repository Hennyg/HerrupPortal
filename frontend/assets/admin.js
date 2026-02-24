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

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean).map(x => String(x).trim()))).sort((a,b)=>a.localeCompare(b));
}

function setDatalistOptions(datalistEl, options) {
  datalistEl.innerHTML = "";
  options.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    datalistEl.appendChild(opt);
  });
}

function setSelectOptions(selectEl, options, { includeEmpty=true, emptyText="(ingen)" } = {}) {
  selectEl.innerHTML = "";
  if (includeEmpty) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = emptyText;
    selectEl.appendChild(o);
  }
  options.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    selectEl.appendChild(o);
  });
}

function updateIconPreview() {
  const v = $("icon").value?.trim();
  $("iconPreview").textContent = v || "🔗";
}

function readForm() {
  return {
    id: $("id").value || null,
    title: $("title").value.trim(),
    url: $("url").value.trim(),
    category: $("category").value,
    group: $("group").value,
    parent: $("parent").value || null,
    icon: $("icon").value.trim(),
    allowedRoles: $("roles").value.trim(),
    enabled: $("enabled").checked,
    sort: Number($("sort").value || 100),
    openMode: $("openMode").value
  };
}

function fillForm(x) {
  $("id").value = x.id || "";
  $("title").value = x.title || "";
  $("url").value = x.url || "";
  $("category").value = x.category || "";
  $("group").value = x.group || "";
  $("parent").value = x.parent || "";
  $("icon").value = x.icon || "";
  updateIconPreview();
  $("roles").value = Array.isArray(x.allowedRoles) ? x.allowedRoles.join(";") : (x.allowedRoles || "");
  $("enabled").checked = x.enabled !== false;
  $("sort").value = x.sort ?? 100;
  $("openMode").value = x.openMode || "newTab";
}

function resetForm() {
  fillForm({ enabled:true, sort:100, openMode:"newTab" });
  $("msg").textContent = "";
}

function buildPickers(rows) {
  const fixedCats  = ["Static Apps", "Favoritter", "Værktøjer", "Administration", "Andet"];
  const fixedGroups = ["Lely", "Salg", "Tekniker", "FMS", "Administration"];
  const fixedIcons = ["🔗","🧩","🐄","🪑","📄","📊","⚙️","🧰","🧑‍💼","📱","🗂️","🌐","🏷️"];

  // Category suggestions (datalist)
  const categories = uniq([...fixedCats, ...rows.map(r => r.category).filter(Boolean)]);
  setDatalistOptions(document.getElementById("categoryList"), categories);

  // Group suggestions (datalist)
  const groups = uniq([...fixedGroups, ...rows.map(r => r.group).filter(Boolean)]);
  setDatalistOptions(document.getElementById("groupList"), groups);

  // Parent dropdown (kun kandidater uden URL)
  const parentCandidates = rows.filter(r => !r.url).map(r => ({ id:r.id, title:r.title }));
  const parentSelect = $("parent");
  parentSelect.innerHTML = "";

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "(ingen parent)";
  parentSelect.appendChild(empty);

  parentCandidates.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.title;
    parentSelect.appendChild(o);
  });

  // Icon suggestions
  const icons = uniq([...fixedIcons, ...rows.map(r => r.icon).filter(Boolean)]);
  const dl = document.getElementById("iconList");
  dl.innerHTML = "";
  icons.forEach(ic => {
    const opt = document.createElement("option");
    opt.value = ic;
    dl.appendChild(opt);
  });
}


function renderTable(rows) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const tb = $("tbl").querySelector("tbody");
  tb.innerHTML = "";

  rows.forEach(x => {
    const parentTitle = x.parent ? (byId.get(x.parent)?.title || x.parent) : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${x.title || ""}</td>
      <td>${x.category || ""}</td>
      <td>${x.group || ""}</td>
      <td>${parentTitle}</td>
      <td>${x.enabled !== false ? "Ja" : "Nej"}</td>
      <td>${Array.isArray(x.allowedRoles) ? x.allowedRoles.join(";") : (x.allowedRoles || "")}</td>
      <td style="white-space:nowrap">
        <button class="btn" data-act="edit">Redigér</button>
        <button class="btn" data-act="del">Slet</button>
      </td>
    `;
    tr.querySelector('[data-act="edit"]').onclick = () => fillForm(x);
    tr.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`Slet "${x.title}"?`)) return;
      await api("DELETE", `/api/links-admin?id=${encodeURIComponent(x.id)}`);
      await refresh();
      resetForm();
    };
    tb.appendChild(tr);
  });
}

async function refresh() {
    console.log("refresh() starter");
  const rows = await api("GET", "/api/links-admin");
  console.log("refresh() rows:", rows);
  const rows = await api("GET", "/api/links-admin");
  const list = (rows || []).sort((a,b) => (a.sort ?? 1000) - (b.sort ?? 1000));
  buildPickers(list);
  renderTable(list);
}

(async function init(){
  console.log("admin.js loaded");
  $("icon").addEventListener("input", updateIconPreview);
  updateIconPreview();

  // ✅ Vis forslag med det samme (selv uden API)
  buildPickers([]);

  $("form").addEventListener("submit", async (e) => { ... });

  $("resetBtn").addEventListener("click", resetForm);

  resetForm();
  try {
    await refresh();
  } catch (err) {
    // ✅ behold stadig pickers
    $("msg").textContent =
      "Kan ikke hente links endnu. (Dropdowns virker stadig). Fejl: " +
      `(${err?.status || "?"})`;
  }
})();


  $("resetBtn").addEventListener("click", resetForm);

  resetForm();
  try {
    await refresh();
  } catch (err) {
    $("msg").textContent =
      "Kan ikke hente links endnu. Mangler du /api/links-admin endpoint? " +
      `Fejl (${err?.status || "?"}).`;
  }
})();
