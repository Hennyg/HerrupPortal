
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

function readForm() {
  return {
    id: $("id").value || null,
    title: $("title").value.trim(),
    url: $("url").value.trim(),
    category: $("category").value,     // dropdown
    group: $("group").value,           // lch_group
    parent: $("parent").value || null, // lch_parent (id)
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

function renderTable(rows) {
  const tb = $("tbl").querySelector("tbody");
  tb.innerHTML = "";
  rows.forEach(x => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${x.title || ""}</td>
      <td>${x.category || ""}</td>
      <td>${x.enabled !== false ? "Ja" : "Nej"}</td>
      <td>${Array.isArray(x.allowedRoles) ? x.allowedRoles.join(";") : (x.allowedRoles || "")}</td>
      <td style="white-space:nowrap">
        <button class="btn" data-act="edit">Redigér</button>
        <button class="btn" data-act="del">Slet</button>
      </td>
      <td>${x.group || ""}</td>
<td>${x.parentTitle || x.parent || ""}</td>
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

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean).map(x => String(x).trim()))).sort((a,b)=>a.localeCompare(b));
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

function buildPickers(rows) {
  // Kategori dropdown (fra eksisterende data + evt. faste)
  const fixedCats = ["Static Apps", "Favoritter", "Værktøjer", "Administration", "Andet"];
  const catsFromData = rows.map(r => r.category);
  const categories = uniq([...fixedCats, ...catsFromData]);
  setSelectOptions($("category"), categories, { includeEmpty:true, emptyText:"(vælg kategori)" });

  // Group dropdown (lch_group)
  const groupsFromData = rows.map(r => r.group);
  const groups = uniq(groupsFromData);
  setSelectOptions($("group"), groups, { includeEmpty:true, emptyText:"(ingen gruppe)" });

  // Parent dropdown (lch_parent): her vælger vi kun "grupper/mapper"
  // Reglen her: parent-kandidater = dem uden URL (eller hvis du senere har et felt "isFolder")
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

  // Ikon forslag fra eksisterende
  const icons = uniq(rows.map(r => r.icon).filter(Boolean));
  const dl = document.getElementById("iconList");
  dl.innerHTML = "";
  icons.forEach(ic => {
    const opt = document.createElement("option");
    opt.value = ic;
    dl.appendChild(opt);
  });
}

async function refresh() {
  const rows = await api("GET", "/api/links-admin");
  const list = (rows || []).sort((a,b) => (a.sort ?? 1000) - (b.sort ?? 1000));

  buildPickers(list);
  renderTable(list);
}

(async function init(){

  // ✅ Sæt ikon-preview listener én gang ved load
  $("icon").addEventListener("input", updateIconPreview);
  updateIconPreview();

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("msg").textContent = "Gemmer...";
    const x = readForm();

    try {
      if (x.id) {
        await api("PUT", "/api/links-admin", x);
      } else {
        await api("POST", "/api/links-admin", x);
      }
      $("msg").textContent = "Gemt ✅";
      await refresh();
      resetForm();
    } catch (err) {
      $("msg").textContent =
        `Fejl (${err?.status || "?"}): ` + (err?.data?.message || JSON.stringify(err?.data || err));
    }
  });

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
