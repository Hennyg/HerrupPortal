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

let lastRows = []; // seneste rows fra refresh()

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
  const v = $("icon")?.value?.trim();
  const p = $("iconPreview");
  if (p) p.textContent = v || "🔗";
}

// Gruppe kun for Favoritter
function updateGroupVisibility() {
  const cat = ($("category")?.value || "").trim().toLowerCase();
  const row = $("groupRow"); // kræver id="groupRow" på label/wrapper i admin.html
  const isFav = cat === "favoritter";
  if (row) row.style.display = isFav ? "" : "none";
  if (!isFav && $("group")) $("group").value = "";
  if (isFav) $("sort").value = "";
}

function readForm() {
  const category = $("category").value || "";
  const isFav = category.trim().toLowerCase() === "favoritter";

  return {
    id: $("id").value || null,
    title: $("title").value.trim(),
    url: $("url").value.trim(),
    category: category,
    group: isFav ? $("group").value : "",
    parent: $("parent").value || null,
    icon: $("icon").value.trim(),
    allowedRoles: $("roles").value.trim(),
    enabled: $("enabled").checked,
    sort: Number($("sort").value || 100),
    openMode: $("openMode").value,

    // NYT felt
    platformHint: $("platformHint")?.value || "All"
  };
}

function fillForm(x) {
  $("id").value = x?.id || "";
  $("title").value = x?.title || "";
  $("url").value = x?.url || "";
  $("category").value = x?.category || "";
  $("group").value = x?.group || "";
  $("parent").value = x?.parent || "";
  $("icon").value = x?.icon || "";
  updateIconPreview();
  $("roles").value = Array.isArray(x?.allowedRoles) ? x.allowedRoles.join(";") : (x?.allowedRoles || "");
  $("enabled").checked = x?.enabled !== false;
  $("sort").value = x?.sort ?? 100;
  $("openMode").value = x?.openMode || "newTab";

  if ($("platformHint")) $("platformHint").value = x?.platformHint || "All";

  updateGroupVisibility();
}

function resetForm() {
  fillForm({ enabled:true, sort:100, openMode:"newTab", platformHint:"All" });
  $("msg").textContent = "";
}

function seedPickersNow() {
  setSelectOptions($("category"),
    ["Static Apps","Favoritter","Værktøjer","Administration","Andet"],
    { includeEmpty:true, emptyText:"(vælg kategori)" }
  );

  setSelectOptions($("group"),
    ["Lely","Salg","Tekniker","FMS","Administration"],
    { includeEmpty:true, emptyText:"(ingen gruppe)" }
  );

  // NYT: platform hint
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

  updateGroupVisibility();
}

function buildPickers(rows) {
  const cats = uniq(["Static Apps","Favoritter","Værktøjer","Administration","Andet", ...rows.map(r => r.category)]);

  const grps = uniq([
    "Lely","Salg","Tekniker","FMS","Administration",
    ...rows.filter(r => (r.category || "").toLowerCase() === "favoritter").map(r => r.group)
  ]);

  setSelectOptions($("category"), cats, { includeEmpty:true, emptyText:"(vælg kategori)" });
  setSelectOptions($("group"), grps, { includeEmpty:true, emptyText:"(ingen gruppe)" });

  // Platform hint – hold fast i 3 værdier, men tillad også værdier fra data
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

  const fixedIcons = ["🔗","🧩","🐄","🪑","📄","📊","⚙️","🧰","🧑‍💼","📱","🗂️","🌐","🏷️"];
  const icons = uniq([...fixedIcons, ...rows.map(r => r.icon).filter(Boolean)]);
  const dl = document.getElementById("iconList");
  dl.innerHTML = "";
  icons.forEach(ic => {
    const opt = document.createElement("option");
    opt.value = ic;
    dl.appendChild(opt);
  });

  updateGroupVisibility();
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
      <td>${x.platformHint || ""}</td>
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

function maybeAutoSortForFavGroup() {
  const cat = ($("category")?.value || "").trim().toLowerCase();
  if (cat !== "favoritter") return;

  const grp = ($("group")?.value || "").trim();
  if (!grp) return;

  // hvis brugeren allerede har skrevet et tal, så respekter det
  const cur = String($("sort")?.value || "").trim();
  if (cur && cur !== "0") return;

  const maxSort = Math.max(
    0,
    ...lastRows
      .filter(r => (r.category || "").toLowerCase() === "favoritter")
      .filter(r => (r.group || "").trim() === grp)
      .map(r => Number(r.sort ?? 0))
      .filter(n => Number.isFinite(n))
  );

  $("sort").value = String(maxSort + 10);
}

async function refresh() {
  console.log("refresh() starter");
  const rows = await api("GET", "/api/links-admin");
  console.log("refresh() rows:", rows);
  const list = (rows || []).sort((a,b) => (a.sort ?? 1000) - (b.sort ?? 1000));
  lastRows = list; // <-- NYT
  buildPickers(list);
  renderTable(list);
  maybeAutoSortForFavGroup(); // <-- NYT (hvis du står på favoritter+gruppe)
}

(async function init(){
  console.log("admin.js loaded");

  seedPickersNow();

  $("icon").addEventListener("input", updateIconPreview);
  updateIconPreview();

$("category").addEventListener("change", () => {
  updateGroupVisibility();
  maybeAutoSortForFavGroup();
});

$("group").addEventListener("change", () => {
  maybeAutoSortForFavGroup();
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
    $("msg").textContent = "API /api/links-admin virker ikke endnu. " +
      `Fejl (${err?.status || "?"}).`;
    console.warn("refresh() fejlede:", err);
  }
})();
