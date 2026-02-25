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
  return Array.from(new Set((arr||[]).filter(Boolean).map(x => String(x).trim())))
    .sort((a,b)=>a.localeCompare(b));
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
  const row = $("groupRow"); // kræver id="groupRow" i admin.html (label eller wrapper)
  const isFav = cat === "favoritter";

  if (row) row.style.display = isFav ? "" : "none";
  if (!isFav && $("group")) $("group").value = "";
}

function readForm() {
  const cat = ($("category").value || "").trim();
  const isFav = cat.toLowerCase() === "favoritter";

  return {
    id: $("id").value || null,
    title: $("title").value.trim(),
    url: $("url").value.trim(),
    category: cat,

    // kun relevant ved favoritter
    group: isFav ? $("group").value : "",

    parent: $("parent").value || null,
    icon: $("icon").value.trim(),
    allowedRoles: $("roles").value.trim(),
    enabled: $("enabled").checked,
    sort: Number($("sort").value || 100),

    // ⚠️ Dataverse lch_openMode er Choice (Int32), så vi sender den ikke som tekst her.
    // Hvis du laver cr175_lch_openModetext senere, kan vi sende den igen.
    openMode: null
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

  // UI: openMode dropdown kan stadig bruges visuelt,
  // men bliver ikke sendt til Dataverse pt.
  $("openMode").value = x?.openMode || "newTab";

  updateGroupVisibility();
}

function resetForm() {
  fillForm({ enabled:true, sort:100, openMode:"newTab" });
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
  // opdatér dropdowns med værdier fundet i data
  const cats = uniq(["Static Apps","Favoritter","Værktøjer","Administration","Andet", ...rows.map(r => r.category)]);

  // grupper kun fra favoritter + defaults
  const grps = uniq([
    "Lely","Salg","Tekniker","FMS","Administration",
    ...rows.filter(r => (r.category || "").toLowerCase() === "favoritter").map(r => r.group)
  ]);

  setSelectOptions($("category"), cats, { includeEmpty:true, emptyText:"(vælg kategori)" });
  setSelectOptions($("group"), grps, { includeEmpty:true, emptyText:"(ingen gruppe)" });

  const parentCandidates = rows.filter(r => !r.url).map(r => ({ id:r.id, title:r.title }));
  const parentSelect = $("parent");
  parentSelect.innerHTML = `<option value="">(ingen parent)</option>`;
  parentCandidates.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.title;
    parentSelect.appendChild(o);
  });

  // Ikon forslag ud fra data + faste
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
  const list = (rows || []).sort((a,b) => (a.sort ?? 1000) - (b.sort ?? 1000));
  buildPickers(list);
  renderTable(list);
}

(async function init(){
  console.log("admin.js loaded");

  // Fyld dropdowns NU (uanset API)
  seedPickersNow();

  $("icon").addEventListener("input", updateIconPreview);
  updateIconPreview();

  $("category").addEventListener("change", updateGroupVisibility);

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
    $("msg").textContent = "API /api/links-admin virker ikke endnu (dropdowns virker stadig). " +
      `Fejl (${err?.status || "?"}).`;
    console.warn("refresh() fejlede:", err);
  }
})();
