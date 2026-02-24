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
    category: $("category").value.trim(),
    icon: $("icon").value.trim(),
    allowedRoles: $("roles").value.trim(), // semikolon-streng (backend kan splitte)
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
  $("icon").value = x.icon || "";
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
    `;
    tr.querySelector('[data-act="edit"]').onclick = () => fillForm(x);
    tr.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`Slet "${x.title}"?`)) return;
      await api("DELETE", `/api/links?id=${encodeURIComponent(x.id)}`);
      await refresh();
      resetForm();
    };
    tb.appendChild(tr);
  });
}

async function refresh() {
  // Forventet API: GET /api/links-admin  (eller /api/links med ?admin=1)
  // Jeg bruger /api/links-admin her; ret hvis dit endpoint hedder noget andet.
  const rows = await api("GET", "/api/links-admin");
  renderTable((rows || []).sort((a,b) => (a.sort ?? 1000) - (b.sort ?? 1000)));
}

(async function init(){
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
      $("msg").textContent = `Fejl (${err?.status || "?"}): ` + (err?.data?.message || JSON.stringify(err?.data || err));
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
