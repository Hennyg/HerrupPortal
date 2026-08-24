// app.js — skærm-navigation og forretningslogik, oversat 1:1 fra Power Apps-formlerne

const state = {
  fileId: null,
  fileName: null,
  farve: null,        // "Gul" | "Gron"
  varer: [],           // varExcelData
  aktivVare: null,     // varAssets
  antal: 0,             // varAntal
  antalGul: null,
  antalGron: null,
  sortDescending: false,
  isAdmin: false
};

// ---------- Hjælpere ----------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showSpinner(visible) {
  document.getElementById("spinner").classList.toggle("hidden", !visible);
}

function showToast(msg, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 1800);
}

function farveTilFuldNavn(f) {
  return f === "Gul" ? "gul" : "gron";
}

// ---------- Init / adgang ----------

async function init() {
  showSpinner(true);
  try {
    const access = await Api.checkAccess();
    if (!access.isStatus) {
      document.body.innerHTML =
        "<div style='padding:60px;text-align:center;font-family:sans-serif;'>" +
        "<h2>Ingen adgang</h2><p>Du skal være medlem af gruppen <b>portal_status</b> for at bruge denne app.</p></div>";
      return;
    }
    state.isAdmin = access.isAdmin;
    await loadFileList();
    showScreen("screen-filevalg");
  } catch (err) {
    document.getElementById("fileError").textContent = err.message;
  } finally {
    showSpinner(false);
  }
}

async function loadFileList() {
  const listEl = document.getElementById("filListe");
  listEl.innerHTML = "";
  const files = await Api.listFiles();
  if (files.length === 0) {
    listEl.innerHTML = "<p>Ingen optællinger fundet i mappen.</p>";
    return;
  }
  files.forEach((f) => {
    const div = document.createElement("div");
    div.className = "file-item";
    const dato = f.lastModified ? new Date(f.lastModified).toLocaleString("da-DK") : "";
    div.innerHTML = `<div>${f.name}</div><div class="file-meta">Sidst ændret: ${dato}</div>`;
    div.addEventListener("click", () => selectFile(f));
    listEl.appendChild(div);
  });
}

function selectFile(f) {
  state.fileId = f.id;
  state.fileName = f.name;
  document.getElementById("lblAktivFil").textContent = f.name;
  showScreen("screen-start");
}

// ---------- Start / farvevalg ----------

function setFarve(f) {
  state.farve = f;
  document.querySelectorAll(".btn-farve").forEach((b) => b.classList.remove("selected"));
  document.querySelector(`.btn-farve[data-farve="${f}"]`).classList.add("selected");
  document.getElementById("btnGul").textContent = f === "Gul" ? "Du er gul" : "Vælg gul";
  document.getElementById("btnGron").textContent = f === "Gron" ? "Du er grøn" : "Vælg grøn";
  document.getElementById("lblVidere").classList.remove("visible");
}

async function hentData() {
  if (!state.farve) {
    document.getElementById("lblVidere").classList.add("visible");
    return;
  }
  showSpinner(true);
  try {
    state.varer = await Api.getVarer(state.fileId);
    showScreen("screen-galleri");
    renderGallery("");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showSpinner(false);
  }
}

// ---------- Datagalleri ----------

function renderGallery(searchText) {
  const search = (searchText || "").trim().toLowerCase();
  let items = state.varer.filter(
    (v) =>
      !search ||
      String(v.varenummer || "").toLowerCase().includes(search) ||
      String(v.varenavn || "").toLowerCase().includes(search)
  );

  items.sort((a, b) => {
    const cmp = String(a.varenummer).localeCompare(String(b.varenummer));
    return state.sortDescending ? -cmp : cmp;
  });

  const gallery = document.getElementById("gallery1");
  gallery.innerHTML = "";

  items.forEach((v) => {
    const gTxt = (v.optaltGul ?? "").toString().trim();
    const rTxt = (v.optaltGron ?? "").toString().trim();
    const gEmpty = gTxt.length === 0;
    const rEmpty = rTxt.length === 0;

    let statusClass = "status-hvid";
    if (gEmpty && !rEmpty) statusClass = "status-gron";
    else if (rEmpty && !gEmpty) statusClass = "status-gul";
    else if (!gEmpty && !rEmpty) statusClass = "status-blaa";

    const div = document.createElement("div");
    div.className = `gallery-item ${statusClass}`;
    div.innerHTML = `
      <div class="gi-left">
        <div class="gi-varenr">${v.varenummer ?? ""}</div>
        <div class="gi-varenavn">${v.varenavn ?? ""}</div>
      </div>
      <div class="gi-right">
        <div>Start: ${v.paaLager ?? ""}</div>
        <div>GUL: ${v.optaltGul ?? ""}</div>
        <div>GRØN: ${v.optaltGron ?? ""}</div>
      </div>`;
    div.addEventListener("click", () => aabnVare(v));
    gallery.appendChild(div);
  });

  // Icon "vare findes ikke" vises kun hvis søgningen ikke gav nogen resultater
  document.getElementById("iconVFI").style.display = search && items.length === 0 ? "block" : "none";
}

function aabnVare(v) {
  state.aktivVare = v;
  state.antalGul = v.optaltGul !== null && v.optaltGul !== "" ? Number(v.optaltGul) : null;
  state.antalGron = v.optaltGron !== null && v.optaltGron !== "" ? Number(v.optaltGron) : null;

  const isGul = state.farve === "Gul";
  state.antal = isGul
    ? (state.antalGul ?? Number(v.paaLager) ?? 0)
    : (state.antalGron ?? Number(v.paaLager) ?? 0);

  renderVareFindes();
  showScreen("screen-varefindes");
}

// ---------- Vare findes ----------

function renderVareFindes() {
  const v = state.aktivVare;
  const g = Number(v.optaltGul) || 0;
  const r = Number(v.optaltGron) || 0;
  const total = g + r;

  document.getElementById("vareInfo").innerHTML = `
    <div>Varenummer: <b>${v.varenummer ?? ""}</b></div>
    <div>Varenavn: <b>${v.varenavn ?? ""}</b></div>
    <div>Noter: <b>${v.notat ?? ""}</b></div>
    <div>Antal på lager ved start: <b>${v.paaLager ?? ""}</b></div>
    <div>Optalt gul: <b>${v.optaltGul ?? ""}</b></div>
    <div>Optalt grøn: <b>${v.optaltGron ?? ""}</b></div>
    <div>Optalt ialt: <b>${total}</b></div>
  `;

  document.getElementById("txtOptaltFindes").value = state.antal;
  document.getElementById("txtErNotat").value = v.notat ?? "";
  document.getElementById("toggleLabel").checked = false;

  const headline = document.getElementById("headlineFindes");
  headline.className = "headline-bar " + (state.farve === "Gul" ? "farve-gul" : "farve-gron");

  const btn = document.getElementById("btnOpdaterVare");
  btn.className = "btn-opdater " + (state.farve === "Gul" ? "farve-gul" : "farve-gron");
}

function endreAntal(delta) {
  const input = document.getElementById("txtOptaltFindes");
  const nyVaerdi = Math.max(0, (Number(input.value) || 0) + delta);
  input.value = nyVaerdi;
  state.antal = nyVaerdi;
}

async function opdaterVare() {
  const antal = Number(document.getElementById("txtOptaltFindes").value) || 0;
  const notatTekst = document.getElementById("txtErNotat").value;
  const labelValgt = document.getElementById("toggleLabel").checked;

  const fuldNotat = labelValgt
    ? notatTekst.trim().length > 0
      ? notatTekst + ", Label: ja"
      : "Label: ja"
    : notatTekst;

  showSpinner(true);
  try {
    await Api.updateVare(state.fileId, {
      varenummer: state.aktivVare.varenummer,
      farve: farveTilFuldNavn(state.farve),
      antal,
      notat: fuldNotat
    });
    showToast("Gemt");
    state.varer = await Api.getVarer(state.fileId);
    showScreen("screen-galleri");
    renderGallery(document.getElementById("txtSearchVare").value);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showSpinner(false);
  }
}

// ---------- Vare findes ikke ----------

function aabnVareFindesIkke() {
  document.getElementById("lblVarenrIkke").textContent = document.getElementById("txtSearchVare").value;
  document.getElementById("txtOptaltFindesIkke").value = 0;
  document.getElementById("txtIkkeNotat").value = "";
  document.getElementById("toggleLabelIkke").checked = false;
  showScreen("screen-varefindesikke");
}

function endreAntalIkke(delta) {
  const input = document.getElementById("txtOptaltFindesIkke");
  const nyVaerdi = Math.max(0, (Number(input.value) || 0) + delta);
  input.value = nyVaerdi;
}

async function opdaterVareIkke() {
  const varenummer = document.getElementById("lblVarenrIkke").textContent.trim();
  if (!varenummer) {
    showToast("Angiv varenummer først", true);
    return;
  }
  const antal = Number(document.getElementById("txtOptaltFindesIkke").value) || 0;
  const notatTekst = document.getElementById("txtIkkeNotat").value;
  const labelValgt = document.getElementById("toggleLabelIkke").checked;
  const fuldNotat = labelValgt
    ? notatTekst.trim().length > 0
      ? notatTekst + ", Label: ja"
      : "Label: ja"
    : notatTekst;

  showSpinner(true);
  try {
    await Api.addVare(state.fileId, {
      varenummer,
      farve: farveTilFuldNavn(state.farve),
      antal,
      notat: fuldNotat
    });
    showToast("Ny linje tilføjet");
    showScreen("screen-galleri");
    renderGallery("");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    showSpinner(false);
  }
}

// ---------- Event wiring ----------

document.getElementById("btnGul").addEventListener("click", () => setFarve("Gul"));
document.getElementById("btnGron").addEventListener("click", () => setFarve("Gron"));
document.getElementById("btnHentData").addEventListener("click", hentData);
document.getElementById("btnSkiftFil").addEventListener("click", async () => {
  await loadFileList();
  showScreen("screen-filevalg");
});

document.getElementById("arrowBack").addEventListener("click", () => showScreen("screen-start"));
document.getElementById("iconRefresh").addEventListener("click", hentData);
document.getElementById("iconSort").addEventListener("click", () => {
  state.sortDescending = !state.sortDescending;
  renderGallery(document.getElementById("txtSearchVare").value);
});
document.getElementById("txtSearchVare").addEventListener("input", (e) => renderGallery(e.target.value));
document.getElementById("iconClearSearch").addEventListener("click", () => {
  document.getElementById("txtSearchVare").value = "";
  renderGallery("");
});
document.getElementById("iconVFI").addEventListener("click", aabnVareFindesIkke);

document.getElementById("arrowBackFindes").addEventListener("click", () => showScreen("screen-galleri"));
document.getElementById("iconMinus").addEventListener("click", () => endreAntal(-1));
document.getElementById("iconPlus").addEventListener("click", () => endreAntal(1));
document.getElementById("txtOptaltFindes").addEventListener("change", (e) => {
  state.antal = Number(e.target.value) || 0;
});
document.getElementById("btnOpdaterVare").addEventListener("click", opdaterVare);

document.getElementById("arrowBackIkke").addEventListener("click", () => showScreen("screen-galleri"));
document.getElementById("iconMinusIkke").addEventListener("click", () => endreAntalIkke(-1));
document.getElementById("iconPlusIkke").addEventListener("click", () => endreAntalIkke(1));
document.getElementById("btnOpdaterIkke").addEventListener("click", opdaterVareIkke);

init();
