// assets/kundeliste/rabat.js
// Kemi-rabat på kundelisten (kun admin): popup med tre faner
//   Kunder        – ret gruppe, robot/yverpleje/tank og kommentar (gemmes med historik)
//   Importér Excel – læs regnearket (alle ark med en "Kundenr."-kolonne), vis ændringer, importér
//   Rabatstruktur – rabat-% pr. gruppe og købsgrænse + farve pr. gruppe
//
// Forudsætter globale: rows (kunder), esc, kundeUrl – findes på kundeliste2.html
// og kundeliste_admin.html. openRabat('kunder' | 'import' | 'struktur').
(function () {
  const API = '/api/kunde-rabat';
  const YD = [['robot', 'Robot'], ['yverpleje', 'Yverpleje'], ['tank', 'Tank']];

  let data = { items: [], struktur: [], kommentarKolonne: true };
  let dirty = new Map();          // kundenr → ændrede felter
  let openHist = new Set();
  let ny = null;                  // række under oprettelse
  let importRows = null;          // læst fra Excel

  async function api(qs, opts = {}) {
    const r = await fetch(`${API}?${qs}`, { cache: 'no-store', ...opts,
      headers: opts.body ? { 'Content-Type': 'application/json' } : {} });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  const $ = id => document.getElementById(id);
  const navnFor = nr => (rows || []).find(k => String(k.kundenr) === String(nr))?.navn || '';
  const normNr = v => { const s = String(v ?? '').trim().replace(/\.0+$/, ''); return /^\d+$/.test(s) && s.length < 10 ? s.padStart(10, '0') : s; };
  const fmtTid = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' }); };

  // Farve pr. gruppe fra rabatstrukturen
  function gruppeFarve(g) { return data.struktur.find(s => s.gruppe === g && s.farve)?.farve || ''; }
  function textOnHex(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? '#111827' : '#fff';
  }
  function gruppeBadge(g) {
    if (g === null || g === undefined || g === '') return '<span class="muted">–</span>';
    const c = gruppeFarve(Number(g));
    return `<span class="rbBadge"${c ? ` style="background:${c};color:${textOnHex(c)}"` : ''}>${esc(g)}</span>`;
  }

  // ── Popup ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .rbBackdrop { position:fixed; inset:0; z-index:210; background:rgba(17,24,39,.5); display:flex; align-items:center; justify-content:center; padding:16px; }
    .rbBackdrop[hidden] { display:none; }
    .rbModal { background:#fff; border-radius:12px; width:min(1200px,100%); height:min(820px,94vh); display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,.3); }
    .rbHead { display:flex; align-items:center; gap:14px; padding:12px 18px; border-bottom:4px solid var(--red); }
    .rbHead h2 { margin:0; font-size:18px; flex:0 0 auto; }
    .rbTabs { display:flex; gap:4px; flex:1; }
    .rbTabs button { border:1px solid #d1d5db; background:#fff; border-radius:8px; padding:6px 12px; cursor:pointer; font:inherit; font-size:14px; }
    .rbTabs button.on { background:var(--red); border-color:var(--red); color:#fff; }
    .rbClose { border:0; background:none; font-size:26px; line-height:1; cursor:pointer; color:#6b7280; }
    .rbView { flex:1; min-height:0; display:flex; flex-direction:column; }
    .rbView[hidden] { display:none; }
    .rbBar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 18px; border-bottom:1px solid var(--border); }
    .rbBar input[type=search], .rbBar input[type=text] { height:34px; border:1px solid #d1d5db; border-radius:8px; padding:0 10px; font:inherit; font-size:14px; min-width:240px; }
    .rbScroll { flex:1; min-height:0; overflow:auto; }
    .rbTable { width:100%; border-collapse:collapse; font-size:13px; }
    .rbTable thead th { position:sticky; top:0; z-index:1; background:#f9fafb; text-align:left; padding:8px; border-bottom:1px solid #d1d5db; white-space:nowrap; }
    .rbTable td { padding:6px 8px; border-bottom:1px solid #eee; vertical-align:middle; }
    .rbTable tr { cursor:default; }
    .rbTable tr.dirty td { background:#fffbeb; }
    .rbTable td.c { text-align:center; }
    .rbTable input[type=checkbox] { width:18px; height:18px; cursor:pointer; }
    .rbTable input[type=text], .rbTable input[type=number], .rbTable select { height:30px; border:1px solid #d1d5db; border-radius:6px; padding:0 6px; font:inherit; font-size:13px; }
    .rbTable input.komm { width:100%; min-width:160px; }
    .rbTable tr.hist td { background:#fafafa; padding:6px 8px 10px 28px; }
    .rbHist { font-size:12px; border-collapse:collapse; }
    .rbHist td { padding:2px 10px 2px 0; border:0; }
    .rbBadge { display:inline-block; min-width:26px; text-align:center; padding:2px 8px; border-radius:999px; font-weight:700; background:#eef0f2; }
    .rbMsg { font-size:13px; }
    .rbMsg.ok { color:#15803d; } .rbMsg.err { color:#991b1b; }
    .rbSt { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; font-weight:600; }
    .rbSt.ny { background:#dcfce7; color:#166534; } .rbSt.opdateret { background:#fef3c7; color:#92400e; }
    .rbSt.uændret { background:#f3f4f6; color:#6b7280; } .rbSt.fejl { background:#fee2e2; color:#991b1b; }
    .rbDiff { font-size:12px; color:#4b5563; }
    .rbProgress { height:8px; background:#f3f4f6; border-radius:99px; overflow:hidden; width:220px; }
    .rbProgress span { display:block; height:100%; background:var(--red); width:0; transition:width .2s; }
    .rbInfo { padding:12px 18px; font-size:13px; color:#4b5563; }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'rbBackdrop';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="rbModal" role="dialog" aria-modal="true" aria-label="Kemi rabat">
      <div class="rbHead">
        <h2>Kemi rabat</h2>
        <div class="rbTabs">
          <button type="button" data-tab="kunder" class="on">Kunder</button>
          <button type="button" data-tab="import">Importér Excel</button>
          <button type="button" data-tab="struktur">Rabatstruktur</button>
        </div>
        <button type="button" class="rbClose" id="rbClose" aria-label="Luk">×</button>
      </div>

      <div class="rbView" id="rbKunder">
        <div class="rbBar">
          <button type="button" class="btn primary" id="rbNy">＋ Kunde</button>
          <input type="search" id="rbSearch" placeholder="Søg kundenr., navn, kommentar…" autocomplete="off">
          <select id="rbFilterG"><option value="">Alle grupper</option></select>
          <span class="muted small" id="rbCount"></span>
          <span class="rbMsg" id="rbMsg"></span>
        </div>
        <div class="rbScroll">
          <table class="rbTable">
            <thead><tr><th>Kundenr.</th><th>Navn</th><th>Gruppe</th><th class="c">Robot</th><th class="c">Yverpleje</th><th class="c">Tank</th><th>Rabat ændring</th><th>Kommentar</th><th></th></tr></thead>
            <tbody id="rbBody"><tr><td colspan="9" class="muted">Henter…</td></tr></tbody>
          </table>
        </div>
        <datalist id="rbKundeList"></datalist>
      </div>

      <div class="rbView" id="rbImport" hidden>
        <div class="rbBar">
          <input type="file" id="rbFile" accept=".xlsx,.xlsm,.xls">
          <button type="button" class="btn primary" id="rbDoImport" disabled>Importér</button>
          <div class="rbProgress" id="rbProg" hidden><span></span></div>
          <span class="rbMsg" id="rbImpMsg"></span>
        </div>
        <div class="rbInfo">Vælg regnearket. Alle ark med en kolonne <b>Kundenr.</b> læses (fx Tabel1, Tabel2 og Tabel3).
          Kolonnerne findes ud fra overskrifterne: <i>Kemi Rabat gr.</i>, <i>Kundenr.</i>, <i>Robot rengøring</i>, <i>Yverpleje</i>, <i>Tank rengøring</i> og <i>Rabat ændring</i> (kolonne H, hvis overskriften ikke findes).
          Rækker med kundenr. 0 (slettede kunder) springes over. Kunder, der ikke er i regnearket, røres ikke.</div>
        <div class="rbScroll">
          <table class="rbTable">
            <thead><tr><th>Ark</th><th>Kundenr.</th><th>Navn</th><th>Gruppe</th><th class="c">Robot</th><th class="c">Yverpleje</th><th class="c">Tank</th><th>Rabat ændring</th><th>Status</th></tr></thead>
            <tbody id="rbImpBody"></tbody>
          </table>
        </div>
      </div>

      <div class="rbView" id="rbStruktur" hidden>
        <div class="rbBar">
          <button type="button" class="btn" id="rbStNy">＋ Række</button>
          <button type="button" class="btn primary" id="rbStGem">Gem rabatstruktur</button>
          <span class="rbMsg" id="rbStMsg"></span>
        </div>
        <div class="rbInfo">Én række pr. gruppe og købsgrænse. Farven bruges for gruppen i hele portalen (samme farve på alle rækker i en gruppe).</div>
        <div class="rbScroll">
          <table class="rbTable" style="max-width:720px">
            <thead><tr><th>Gruppe</th><th>Købsgrænse (kr.)</th><th>Rabat %</th><th>Farve</th><th></th></tr></thead>
            <tbody id="rbStBody"></tbody>
          </table>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  function msg(id, text, cls = '') { const el = $(id); el.className = 'rbMsg ' + cls; el.textContent = text; }

  function tab(name) {
    wrap.querySelectorAll('.rbTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $('rbKunder').hidden = name !== 'kunder';
    $('rbImport').hidden = name !== 'import';
    $('rbStruktur').hidden = name !== 'struktur';
    if (name === 'struktur') renderStruktur();
  }
  wrap.querySelectorAll('.rbTabs button').forEach(b => b.onclick = () => tab(b.dataset.tab));

  async function open(fane = 'kunder') {
    wrap.hidden = false;
    tab(fane);
    await load();
    if (fane === 'struktur') renderStruktur();
  }
  function close() { wrap.hidden = true; }
  $('rbClose').onclick = close;
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !wrap.hidden) close(); });

  async function load() {
    $('rbBody').innerHTML = '<tr><td colspan="9" class="muted">Henter…</td></tr>';
    try {
      data = await api('action=liste');
      dirty.clear();
      renderKunder();
      if (!data.kommentarKolonne) msg('rbMsg', 'Bemærk: kolonnen lch_kommentar findes ikke i lch_rabat_grupper endnu', 'err');
    } catch (e) {
      $('rbBody').innerHTML = `<tr><td colspan="9" class="rbMsg err">Fejl: ${esc(e.message)}</td></tr>`;
    }
  }

  // ── Fanen Kunder ─────────────────────────────────────────────────────────
  function vaerdi(r, f) { const d = dirty.get(r.kundenr); return d && f in d ? d[f] : r[f]; }

  function rowHtml(r, isNew) {
    const d = dirty.has(r.kundenr) || isNew;
    const g = vaerdi(r, 'gruppe');
    const grupper = [...new Set([1, 2, 3, ...data.struktur.map(s => s.gruppe).filter(Number.isFinite)])].sort((a, b) => a - b);
    return `<tr data-nr="${esc(r.kundenr)}"${d ? ' class="dirty"' : ''}>
      <td>${isNew ? `<input type="text" id="rbNyNr" list="rbKundeList" placeholder="Kundenr. eller navn" style="width:170px">` : esc(r.kundenr)}</td>
      <td>${isNew ? '<span class="muted" id="rbNyNavn"></span>' : (r.navn || navnFor(r.kundenr)) ? `<a class="link" href="${esc(kundeUrl(r.kundenr))}">${esc(r.navn || navnFor(r.kundenr))}</a>` : '<span class="muted">–</span>'}</td>
      <td style="white-space:nowrap">${gruppeBadge(g)}
        <select data-f="gruppe" title="Gruppe – foreslås ud fra antal ydelser">
          <option value=""${g === null || g === '' ? ' selected' : ''}>–</option>
          ${grupper.map(n => `<option value="${n}"${Number(g) === n ? ' selected' : ''}>${n}</option>`).join('')}
        </select></td>
      ${YD.map(([f]) => `<td class="c"><input type="checkbox" data-f="${f}"${vaerdi(r, f) ? ' checked' : ''}></td>`).join('')}
      <td class="small">${esc(r.rabatchange || '')}</td>
      <td><input type="text" class="komm" data-f="kommentar" value="${esc(vaerdi(r, 'kommentar') || '')}" maxlength="4000"${data.kommentarKolonne ? '' : ' disabled title="Opret kolonnen lch_kommentar i lch_rabat_grupper"'}></td>
      <td style="white-space:nowrap">
        <button type="button" class="btn primary" data-act="gem"${d ? '' : ' disabled'}>Gem</button>
        ${isNew ? '<button type="button" class="btn" data-act="annuller">Annuller</button>' : `<button type="button" class="btn" data-act="hist" title="Vis historik">${openHist.has(r.kundenr) ? '▾' : '▸'} Historik</button>`}
      </td>
    </tr>${!isNew && openHist.has(r.kundenr) ? `<tr class="hist"><td colspan="9" id="rbHist-${esc(r.kundenr)}"><span class="muted">Henter historik…</span></td></tr>` : ''}`;
  }

  function renderKunder() {
    const q = $('rbSearch').value.trim().toLowerCase();
    const fg = $('rbFilterG').value;
    const grupper = [...new Set(data.items.map(r => r.gruppe).filter(g => g !== null))].sort((a, b) => a - b);
    const sel = $('rbFilterG');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Alle grupper</option>' + grupper.map(g => `<option value="${g}">Gruppe ${g}</option>`).join('') + '<option value="-">Uden gruppe</option>';
    sel.value = cur;

    const list = data.items
      .map(r => ({ ...r, navn: r.navn || navnFor(r.kundenr) }))
      .filter(r => !q || [r.kundenr, r.navn, r.kommentar, r.rabatchange].join(' ').toLowerCase().includes(q))
      .filter(r => !fg || (fg === '-' ? r.gruppe === null : String(r.gruppe) === fg))
      .sort((a, b) => (a.navn || '').localeCompare(b.navn || '', 'da') || a.kundenr.localeCompare(b.kundenr));
    $('rbCount').textContent = `${list.length} af ${data.items.length} kunder`;
    $('rbBody').innerHTML = (ny ? rowHtml(ny, true) : '') + (list.map(r => rowHtml(r, false)).join('') ||
      (ny ? '' : `<tr><td colspan="9" class="muted">${q || fg ? 'Ingen match' : 'Ingen kunder i rabatordningen endnu – brug fanen Importér Excel'}</td></tr>`));
    wireRows();
    openHist.forEach(loadHist);
  }

  function wireRows() {
    $('rbBody').querySelectorAll('tr[data-nr]').forEach(tr => {
      const isNew = !!tr.querySelector('#rbNyNr');
      const r = isNew ? ny : data.items.find(x => x.kundenr === tr.dataset.nr);
      const set = (f, v) => {
        if (isNew) { ny[f] = v; }
        else { const d = dirty.get(r.kundenr) || {}; d[f] = v; dirty.set(r.kundenr, d); }
      };
      tr.querySelectorAll('[data-f]').forEach(el => {
        const ev = el.type === 'text' ? 'input' : 'change';
        el.addEventListener(ev, () => {
          const f = el.dataset.f;
          if (el.type === 'checkbox') {
            set(f, el.checked);
            // Gruppe foreslås = antal ydelser (som i regnearket)
            const n = YD.filter(([y]) => isNew ? ny[y] : vaerdi(r, y)).length;
            set('gruppe', n || null);
            const s = tr.querySelector('select[data-f=gruppe]'); s.value = n ? String(n) : '';
            s.previousElementSibling.outerHTML = gruppeBadge(n || null);
          } else if (f === 'gruppe') {
            set(f, el.value === '' ? null : Number(el.value));
            el.previousElementSibling.outerHTML = gruppeBadge(el.value === '' ? null : Number(el.value));
          } else {
            set(f, el.value);
          }
          tr.classList.add('dirty');
          tr.querySelector('[data-act=gem]').disabled = false;
        });
      });
      if (isNew) {
        const inp = tr.querySelector('#rbNyNr');
        inp.addEventListener('input', () => {
          const nr = normNr(inp.value.split(' – ')[0]);
          const navn = navnFor(nr);
          $('rbNyNavn').textContent = navn || (inp.value ? 'Ukendt kundenr.' : '');
          ny.kundenr = nr;
        });
        setTimeout(() => inp.focus());
      }
      tr.querySelector('[data-act=gem]').onclick = () => gem(tr, r, isNew);
      tr.querySelector('[data-act=annuller]')?.addEventListener('click', () => { ny = null; renderKunder(); });
      tr.querySelector('[data-act=hist]')?.addEventListener('click', () => {
        openHist.has(r.kundenr) ? openHist.delete(r.kundenr) : openHist.add(r.kundenr);
        renderKunder();
      });
    });
  }

  async function gem(tr, r, isNew) {
    const body = isNew ? { ...ny } : { kundenr: r.kundenr, ...(dirty.get(r.kundenr) || {}) };
    if (isNew) {
      if (!body.kundenr || !navnFor(body.kundenr)) { msg('rbMsg', 'Vælg en kunde fra listen', 'err'); return; }
      if (data.items.some(x => x.kundenr === body.kundenr)) { msg('rbMsg', 'Kunden er allerede i rabatordningen', 'err'); return; }
    }
    tr.querySelectorAll('button').forEach(b => b.disabled = true);
    msg('rbMsg', 'Gemmer…');
    try {
      const res = await api('action=gem', { method: 'POST', body: JSON.stringify(body) });
      if (isNew) ny = null;
      await load();
      msg('rbMsg', res.status === 'uændret' ? 'Ingen ændringer' : `Gemt ✓ (${res.changes} ændring${res.changes === 1 ? '' : 'er'} i historikken)`, 'ok');
    } catch (e) {
      msg('rbMsg', 'Fejl: ' + e.message, 'err');
      tr.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  }

  async function loadHist(nr) {
    const cell = $(`rbHist-${nr}`);
    if (!cell) return;
    try {
      const items = (await api(`action=historik&kundenr=${encodeURIComponent(nr)}`)).items || [];
      cell.innerHTML = items.length
        ? `<table class="rbHist">${items.map(h => `<tr><td>${esc(fmtTid(h.tid))}</td><td><b>${esc(h.label)}</b></td><td>${esc(h.gammel || '–')} → ${esc(h.ny || '–')}</td><td class="muted">${esc(h.af)}</td><td class="muted">${esc(h.kilde)}</td><td class="muted">${esc(h.note)}</td></tr>`).join('')}</table>`
        : '<span class="muted">Ingen historik</span>';
    } catch (e) {
      cell.innerHTML = `<span class="rbMsg err">Fejl: ${esc(e.message)}</span>`;
    }
  }

  $('rbSearch').oninput = renderKunder;
  $('rbFilterG').onchange = renderKunder;
  $('rbNy').onclick = () => {
    if (ny) return;
    ny = { kundenr: '', gruppe: null, robot: false, yverpleje: false, tank: false, kommentar: '' };
    $('rbKundeList').innerHTML = (rows || []).map(k => `<option value="${esc(k.kundenr)} – ${esc(k.navn)}"></option>`).join('');
    renderKunder();
  };

  // ── Fanen Importér Excel ─────────────────────────────────────────────────
  let xlsxLib = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLib) {
      xlsxLib = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        sc.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('Excel-læseren blev ikke indlæst'));
        sc.onerror = () => reject(new Error('Kunne ikke hente Excel-læseren'));
        document.head.appendChild(sc);
      });
      xlsxLib.catch(() => { xlsxLib = null; });
    }
    return xlsxLib;
  }

  const norm = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim();
  // Kolonner ud fra overskrifterne
  function findCols(header) {
    const idx = (test) => header.findIndex(h => test(norm(h)));
    return {
      gruppe: idx(h => h.includes('rabat gr') || h.includes('kemi rabat')),
      kundenr: idx(h => h.startsWith('kundenr') || h === 'kunde nr' || h === 'kunde nr.'),
      navn: idx(h => h === 'navn' || h.startsWith('navn')),
      robot: idx(h => h.includes('robot')),
      yverpleje: idx(h => h.includes('yver')),
      tank: idx(h => h.includes('tank')),
      change: idx(erRabatAendring)
    };
  }
  // "Rabat ændring" (også stavet uden mellemrum, med bindestreg, ae osv.)
  const erRabatAendring = h => /ændr|aendr|rabat ?change/.test(h);

  // Kolonnen med rabat ændring kan have overskriften i en række over
  // kolonneoverskrifterne (i Vest står "kommentar til leveringssted" over den).
  // Vi kigger derfor også i de 2 rækker over – og bruger den kolonne, hvis
  // der ikke findes en "Rabat ændring"-overskrift.
  function findChangeCol(grid, h, c) {
    if (c.change >= 0) return c.change;
    for (const up of [h - 1, h - 2]) {
      if (up < 0) continue;
      const i = grid[up].findIndex(x => erRabatAendring(norm(x)));
      if (i >= 0) return i;
    }
    for (const up of [h - 1, h - 2]) {
      if (up < 0) continue;
      const i = grid[up].findIndex(x => norm(x).includes('kommentar'));
      if (i >= 0) return i;
    }
    return RABAT_KOLONNE;           // sidste udvej: kolonne H i alle tre ark
  }
  const RABAT_KOLONNE = 7;          // H (A = 0)
  // Kundenr. 0 = kunden er slettet i kundelisten → importeres ikke
  const erSlettet = nr => /^0+$/.test(String(nr || ''));

  async function readFile(file) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const out = [];
    const ark = [];
    for (const name of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
      // Overskriftsrækken = første række med en "Kundenr."-celle (søg i de første 15)
      let h = -1;
      for (let i = 0; i < Math.min(grid.length, 15); i++) {
        if (grid[i].some(c => norm(c).startsWith('kundenr'))) { h = i; break; }
      }
      if (h < 0) continue;
      const c = findCols(grid[h]);
      c.change = findChangeCol(grid, h, c);
      let n = 0, slettede = 0;
      for (let i = h + 1; i < grid.length; i++) {
        const row = grid[i];
        const nr = normNr(row[c.kundenr]);
        if (!nr) continue;
        if (erSlettet(nr)) { slettede++; continue; }
        const gr = parseInt(String(row[c.gruppe] ?? '').trim(), 10);
        const r = { ark: name, kundenr: nr, navnExcel: c.navn >= 0 ? String(row[c.navn] ?? '').trim() : '' };
        if (c.gruppe >= 0) r.gruppe = Number.isFinite(gr) ? gr : null;
        if (c.robot >= 0) r.robot = String(row[c.robot] ?? '').trim() !== '' && String(row[c.robot]).trim() !== '0';
        if (c.yverpleje >= 0) r.yverpleje = String(row[c.yverpleje] ?? '').trim() !== '' && String(row[c.yverpleje]).trim() !== '0';
        if (c.tank >= 0) r.tank = String(row[c.tank] ?? '').trim() !== '' && String(row[c.tank]).trim() !== '0';
        // Rabat ændring kun i de ark, der har kolonnen (Vest/Tabel1) – teksten tages som den står
        if (c.change >= 0) r.rabatchange = String(row[c.change] ?? '').trim();
        out.push(r);
        n++;
      }
      ark.push(`${name}: ${n}${slettede ? ` (+${slettede} med kundenr. 0 sprunget over)` : ''}`);
    }
    return { rows: out, ark };
  }

  // Sammenlign med det, der allerede er i Dataverse
  function diff(r) {
    const cur = data.items.find(x => x.kundenr === r.kundenr);
    if (!navnFor(r.kundenr) && !cur) return { status: 'fejl', text: 'Kundenr. findes ikke i kundelisten' };
    if (!cur) return { status: 'ny', text: '' };
    const d = [];
    if ('gruppe' in r && (r.gruppe ?? null) !== (cur.gruppe ?? null)) d.push(`gruppe ${cur.gruppe ?? '–'} → ${r.gruppe ?? '–'}`);
    YD.forEach(([f, l]) => { if (f in r && !!r[f] !== !!cur[f]) d.push(`${r[f] ? '+' : '-'} ${l.toLowerCase()}`); });
    if ('rabatchange' in r && (r.rabatchange || '') !== (cur.rabatchange || '')) d.push('rabat ændring');
    return d.length ? { status: 'opdateret', text: d.join(', ') } : { status: 'uændret', text: '' };
  }

  function renderImport(results) {
    const res = new Map((results || []).map(x => [x.kundenr, x]));
    const yes = v => v ? '✓' : '';
    $('rbImpBody').innerHTML = (importRows || []).map(r => {
      const x = res.get(r.kundenr);
      const d = x ? { status: x.status, text: x.error || '' } : diff(r);
      return `<tr>
        <td class="small muted">${esc(r.ark)}</td><td>${esc(r.kundenr)}</td><td>${esc(navnFor(r.kundenr) || r.navnExcel)}</td>
        <td>${gruppeBadge(r.gruppe)}</td><td class="c">${yes(r.robot)}</td><td class="c">${yes(r.yverpleje)}</td><td class="c">${yes(r.tank)}</td>
        <td class="small">${esc(r.rabatchange || '')}</td>
        <td><span class="rbSt ${esc(d.status)}">${esc(d.status)}</span> <span class="rbDiff">${esc(d.text)}</span></td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="muted">Ingen rækker</td></tr>';
  }

  $('rbFile').onchange = async () => {
    const f = $('rbFile').files[0];
    if (!f) return;
    $('rbDoImport').disabled = true;
    msg('rbImpMsg', 'Læser regnearket…');
    try {
      if (!data.items.length && !data.struktur.length) await load();
      const { rows: list, ark } = await readFile(f);
      // Samme kundenr. i flere ark: den sidste vinder
      const seen = new Map();
      list.forEach(r => seen.set(r.kundenr, r));
      const dubletter = list.length - seen.size;
      importRows = [...seen.values()];
      renderImport();
      const st = importRows.map(diff).reduce((a, d) => (a[d.status] = (a[d.status] || 0) + 1, a), {});
      msg('rbImpMsg', `${ark.join(' · ') || 'Ingen ark med en Kundenr.-kolonne'} → ${st.ny || 0} nye, ${st.opdateret || 0} ændrede, ${st.uændret || 0} uændrede, ${st.fejl || 0} fejl${dubletter ? ` · ${dubletter} dubletter (sidste bruges)` : ''}`, st.fejl ? 'err' : '');
      $('rbDoImport').disabled = !((st.ny || 0) + (st.opdateret || 0));
    } catch (e) {
      msg('rbImpMsg', 'Fejl: ' + e.message, 'err');
    }
  };

  $('rbDoImport').onclick = async () => {
    const todo = importRows.filter(r => ['ny', 'opdateret'].includes(diff(r).status));
    if (!todo.length || !confirm(`Importér ${todo.length} kunder? Ændringerne skrives i historikken med kilde "Import".`)) return;
    $('rbDoImport').disabled = true;
    const prog = $('rbProg'); prog.hidden = false;
    const results = [];
    const CHUNK = 15;
    for (let i = 0; i < todo.length; i += CHUNK) {
      msg('rbImpMsg', `Importerer ${Math.min(i + CHUNK, todo.length)} af ${todo.length}…`);
      try {
        const chunk = todo.slice(i, i + CHUNK).map(({ navnExcel, ...r }) => r);
        const j = await api('action=import', { method: 'POST', body: JSON.stringify({ rows: chunk }) });
        results.push(...(j.results || []));
      } catch (e) {
        todo.slice(i, i + CHUNK).forEach(r => results.push({ kundenr: r.kundenr, status: 'fejl', error: e.message }));
      }
      prog.firstElementChild.style.width = `${Math.round(Math.min(i + CHUNK, todo.length) / todo.length * 100)}%`;
    }
    const fejl = results.filter(r => r.status === 'fejl').length;
    renderImport(results);
    msg('rbImpMsg', `Import færdig ✓ ${results.length - fejl} gemt${fejl ? `, ${fejl} fejl (se Status)` : ''}`, fejl ? 'err' : 'ok');
    await load();
  };

  // ── Fanen Rabatstruktur ──────────────────────────────────────────────────
  let stDraft = [];
  function renderStruktur() {
    stDraft = data.struktur.map(s => ({ ...s }));
    drawStruktur();
  }
  function drawStruktur() {
    $('rbStBody').innerHTML = stDraft.map((s, i) => `
      <tr>
        <td><input type="number" data-i="${i}" data-f="gruppe" value="${s.gruppe ?? ''}" min="0" max="99" style="width:70px"></td>
        <td><input type="number" data-i="${i}" data-f="koebsgraense" value="${s.koebsgraense ?? ''}" min="0" step="1000" style="width:120px"></td>
        <td><input type="number" data-i="${i}" data-f="rabatprocent" value="${s.rabatprocent ?? ''}" min="0" max="100" style="width:80px"> %</td>
        <td><input type="color" data-i="${i}" data-f="farve" value="${s.farve || '#eef0f2'}"> ${gruppeBadgeDraft(s)}</td>
        <td><button type="button" class="btn" data-del="${i}">Slet</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Ingen rækker – tilføj fx gruppe 1, 10.000 kr., 4 %</td></tr>';
    $('rbStBody').querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
      const s = stDraft[+inp.dataset.i];
      const f = inp.dataset.f;
      s[f] = f === 'farve' ? inp.value : (inp.value === '' ? null : Number(inp.value));
      // Samme farve på alle rækker i gruppen
      if (f === 'farve') stDraft.forEach(x => { if (x.gruppe === s.gruppe) x.farve = inp.value; });
      if (f === 'farve' || f === 'gruppe') drawStruktur();
    }));
    $('rbStBody').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const s = stDraft[+b.dataset.del];
      if (s.id) {
        if (!confirm(`Slet rækken gruppe ${s.gruppe} / ${s.koebsgraense} kr.?`)) return;
        try { await api(`action=struktur&id=${s.id}`, { method: 'DELETE' }); }
        catch (e) { msg('rbStMsg', 'Fejl: ' + e.message, 'err'); return; }
        data.struktur = data.struktur.filter(x => x.id !== s.id);
      }
      stDraft.splice(+b.dataset.del, 1);
      drawStruktur();
    });
  }
  function gruppeBadgeDraft(s) {
    return s.farve ? `<span class="rbBadge" style="background:${s.farve};color:${textOnHex(s.farve)}">${esc(s.gruppe ?? '')}</span>` : '';
  }
  $('rbStNy').onclick = () => { stDraft.push({ gruppe: null, koebsgraense: null, rabatprocent: null, farve: '' }); drawStruktur(); };
  $('rbStGem').onclick = async () => {
    msg('rbStMsg', 'Gemmer…');
    try {
      const j = await api('action=struktur', { method: 'POST', body: JSON.stringify({ items: stDraft }) });
      data.struktur = j.items || [];
      renderStruktur();
      renderKunder();
      msg('rbStMsg', 'Gemt ✓', 'ok');
    } catch (e) {
      msg('rbStMsg', 'Fejl: ' + e.message, 'err');
    }
  };

  window.openRabat = open;
})();
