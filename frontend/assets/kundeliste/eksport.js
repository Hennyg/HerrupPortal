// assets/kundeliste/eksport.js
// "Udskriv liste" på kundelisten: vælg kolonner og kopiér, hent som Excel
// eller udskriv. Bruger de kunder, der er vist i listen lige nu (søgning,
// filtre og knapper gælder).
//
//   Én linje pr. kunde   – kundefelter (+ serviceaftale-kolonner)
//   Én linje pr. produkt – kundefelter + produktfelter + options (udstyr)
//
// Forudsætter kundelistens globale: filtered, COLDEF, KL_KOLONNER, ensureSa,
// saFor, activeCols, esc – og KL_UDSTYR_KEYS fra udstyr.js.
(function () {
  const STORE = 'kundeliste_eksport';

  // ── Felter ───────────────────────────────────────────────────────────────
  const KUNDE_FELTER = KL_KOLONNER.map(c => ({
    id: 'k:' + c.key, gruppe: ['Serviceaftale', 'Kemi rabat'].includes(c.gruppe) ? c.gruppe : 'Kunde', label: c.label,
    value: (k) => cleanText(COLDEF[c.key] ? COLDEF[c.key].text(k) : k[c.key])
  }));
  // Pænere tekst til eksport end filterteksten
  const pretty = {
    'k:aktiv': k => k.aktiv ? 'Ja' : 'Nej',
    'k:sa_aftaler': k => saFor(k).map(a => a.servicetype || a.varenr).filter(Boolean).join(', '),
    'k:sa_varenr': k => saFor(k).map(a => a.varenr || '–').join(', '),
    'k:sa_servicetype': k => saFor(k).map(a => a.servicetype || '–').join(', '),
    'k:sa_afdeling': k => saFor(k).map(a => a.afdeling || '–').join(', '),
    'k:sa_start': k => saFor(k).map(a => fmtDate(a.startdato) || '–').join(', '),
    'k:sa_slut': k => saFor(k).map(a => fmtDate(a.enddato) || '–').join(', '),
    'k:sa_note': k => saFor(k).map(a => a.note || '–').join(' | ')
  };
  KUNDE_FELTER.forEach(f => { if (pretty[f.id]) f.value = k => cleanText(pretty[f.id](k)); });

  // Adresse / Postnr. / By: alle kundens adresser ved "én linje pr. kunde",
  // men kun produktets egen adresse ved "én linje pr. produkt"
  const adrFelt = { 'k:adresse': 'adresse', 'k:postnr': 'postnr', 'k:by': 'by' };
  KUNDE_FELTER.forEach(f => {
    const a = adrFelt[f.id];
    if (!a) return;
    f.value = (k, p) => cleanText(p ? p[a] : (k.adresser || []).map(x => x[a]).filter(Boolean).join(' / '));
  });

  const dk = s => {             // datoer fra Excel/Dataverse som dd-mm-åååå
    const v = String(s || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return v;
  };
  const PRODUKT_FELTER = [
    ['produkt', 'Produkt', p => p.produkt],
    ['produktnr', 'Prod. nr', p => p.produktnr],
    ['serienr', 'S/N', p => p.serienr],
    ['kontrakt', 'Kontrakt (produkt)', p => p.kontrakt],
    ['inst', 'Installationsdato', p => dk(p.installationsdato)],
    ['garstart', 'Garanti start', p => dk(p.garantistart)],
    ['garslut', 'Garanti udløb', p => dk(p.garantiudloeb)],
    ['nsdato', 'Næste service dato', p => dk(p.naesteservicedato)],
    ['nstype', 'Næste service type', p => p.naesteservicetype],
    ['tags', 'Tags type', p => p.tagstype],
    ['recog', 'Recognition', p => p.recognition],
    ['receiver', 'Receiver', p => p.receiver],
    ['pnote', 'Note (produkt)', p => p.note]
  ].map(([key, label, get]) => ({ id: 'p:' + key, gruppe: 'Produkt', label, value: (k, p) => cleanText(get(p)) }));

  const BLANK = [
    { id: 'b:kryds', gruppe: 'Tomme kolonner', label: '✓', blank: true, width: '12mm', title: 'Tom kolonne til afkrydsning' },
    { id: 'b:bem', gruppe: 'Tomme kolonner', label: 'Bemærkning', blank: true, width: '45mm', title: 'Tom kolonne: Bemærkning' }
  ];

  let produkter = null;          // alle aktive produkter (hentes første gang)
  let optionKeys = [...KL_UDSTYR_KEYS];
  // Option-nøgler sammenlignes uden hensyn til store/små bogstaver og mellemrum,
  // så fx "Sand" i data matcher "SAND" i listen.
  const normKey = k => String(k ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  function udstyrVal(p, key) {
    if (!p?.udstyr) return '';
    if (p.udstyr[key] !== undefined) return p.udstyr[key];
    if (!p._ud) p._ud = new Map(Object.entries(p.udstyr).map(([k, v]) => [normKey(k), v]));
    return p._ud.get(normKey(key)) ?? '';
  }
  const optFelt = key => ({ id: 'o:' + key, gruppe: 'Options', label: key, option: key, value: (k, p) => cleanText(udstyrVal(p, key)) });

  // Kemi rabat-data hentes, selv om kolonnerne ikke vises i listen
  async function ensureRbFor() {
    if (rbByKunde) return;
    const r = await fetch('/api/kunde-rabat?action=kolonner', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    rbByKunde = new Map((j.items || []).map(x => [String(x.kundenr), x]));
    rbStruktur = j.struktur || [];
  }
  function cleanText(v) { return String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim(); }

  // ── Popup ────────────────────────────────────────────────────────────────
  const css = `
    .exBackdrop { position:fixed; inset:0; z-index:220; background:rgba(17,24,39,.5); display:flex; align-items:center; justify-content:center; padding:16px; }
    .exBackdrop[hidden] { display:none; }
    .exModal { background:#fff; border-radius:12px; width:min(980px,100%); max-height:92vh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,.3); }
    .exHead { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 18px; border-bottom:4px solid var(--red); }
    .exHead h2 { margin:0; font-size:18px; }
    .exHead .muted { font-size:13px; }
    .exClose { border:0; background:none; font-size:26px; line-height:1; cursor:pointer; color:#6b7280; }
    .exBody { padding:12px 18px; overflow:auto; display:grid; gap:12px; }
    .exRow { display:flex; gap:16px; flex-wrap:wrap; align-items:center; }
    .exRow label.lbl { font-size:13px; font-weight:600; }
    .exRow input[type=text] { height:34px; border:1px solid #d1d5db; border-radius:7px; padding:0 9px; font:inherit; font-size:14px; min-width:280px; }
    .exSeg { display:inline-flex; border:1px solid #d1d5db; border-radius:8px; overflow:hidden; }
    .exSeg label { padding:6px 12px; cursor:pointer; font-size:14px; }
    .exSeg input { display:none; }
    .exSeg label:has(input:checked) { background:var(--red); color:#fff; }
    .exGroups { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:10px; }
    .exGroup { border:1px solid var(--border); border-radius:8px; padding:8px 10px; }
    .exGroup.disabled { opacity:.45; }
    .exGroup h4 { margin:0 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#6b7280; display:flex; justify-content:space-between; align-items:center; }
    .exGroup h4 button { border:0; background:none; color:var(--red); font-size:12px; cursor:pointer; text-transform:none; letter-spacing:0; }
    .exGroup label { display:flex; align-items:flex-start; gap:6px; font-size:13px; padding:2px 0; }
    .exGroup.options { grid-column:1 / -1; }
    .exGroup.options .exOptList { columns:3 220px; }
    .exGroup h4 .exGroupBtns { display:flex; gap:8px; align-items:center; }
    .exReqWrap { position:relative; }
    .exGroup h4 .exReqBtn { color:#374151; border:1px solid #d1d5db; border-radius:6px; padding:1px 6px; background:#fff; }
    .exGroup h4 .exReqBtn.isSet { color:var(--red); border-color:var(--red); background:#fdf2f2; font-weight:700; }
    .exReqPop { position:absolute; right:0; top:calc(100% + 4px); z-index:5; background:#fff; border:1px solid var(--border); border-radius:8px;
                box-shadow:0 10px 30px rgba(0,0,0,.18); min-width:240px; max-width:340px; max-height:300px; overflow:auto; padding:6px 0;
                text-transform:none; letter-spacing:0; color:#111; font-weight:400; }
    .exReqPop[hidden] { display:none; }
    .exReqPop .exReqHead { font-size:12px; color:#6b7280; padding:2px 10px 6px; border-bottom:1px solid #eee; margin-bottom:4px; }
    .exReqPop label { display:flex; align-items:center; gap:6px; padding:3px 10px; font-size:13px; cursor:pointer; }
    .exReqPop label:hover { background:#f9fafb; }
    .exGroup label .exReqMark { color:var(--red); font-weight:700; margin-left:2px; }
    .exReqRow { font-size:14px; }
    .exReqRow select { height:32px; border:1px solid #d1d5db; border-radius:7px; padding:0 6px; font:inherit; font-size:14px; }
    .exFoot { display:flex; align-items:center; gap:8px; padding:12px 18px; border-top:1px solid var(--border); flex-wrap:wrap; }
    .exFoot .msg { flex:1; font-size:13px; min-width:200px; }
    .exFoot .msg.ok { color:#15803d; } .exFoot .msg.err { color:#991b1b; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'exBackdrop';
  wrap.id = 'exBackdrop';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="exModal" role="dialog" aria-modal="true" aria-labelledby="exTitle">
      <div class="exHead">
        <div><h2 id="exTitle">Udskriv kundeliste</h2><div class="muted" id="exInfo"></div></div>
        <button type="button" class="exClose" id="exClose" aria-label="Luk">×</button>
      </div>
      <div class="exBody">
        <div class="exRow">
          <label class="lbl" for="exOverskrift">Overskrift</label>
          <input type="text" id="exOverskrift" value="Kundeliste" maxlength="120">
          <span class="exSeg" title="Én linje pr. produkt giver adgang til produktfelter og options">
            <label><input type="radio" name="exNiveau" value="kunde" checked>Én linje pr. kunde</label>
            <label><input type="radio" name="exNiveau" value="produkt">Én linje pr. produkt</label>
          </span>
        </div>
        <div class="exRow" id="exOptFilterRow" hidden>
          <label style="display:flex;gap:6px;align-items:center;font-size:14px">
            <input type="checkbox" id="exKunMedOption"> Kun produkter, hvor mindst én af de valgte options er udfyldt
          </label>
        </div>
        <div class="exRow exReqRow" id="exReqRow" hidden>
          <span><b>Skal være udfyldt:</b> <span id="exReqList"></span></span>
          <select id="exReqMode" title="Hvordan kravene kombineres">
            <option value="alle">Alle felterne skal have tekst</option>
            <option value="mindst">Mindst ét af felterne skal have tekst</option>
          </select>
          <button type="button" class="btn" id="exReqClear">Ryd krav</button>
        </div>
        <div class="exGroups" id="exGroups"></div>
      </div>
      <div class="exFoot">
        <span class="msg" id="exMsg"></span>
        <button type="button" class="btn" id="exCopy" title="Kopiér som tabel (tabulator-adskilt) – klar til Excel/Outlook">📋 Kopiér</button>
        <button type="button" class="btn" id="exExcel" title="Hent som Excel-fil med en tabel">📊 Excel</button>
        <button type="button" class="btn primary" id="exPrint">🖨️ Udskriv</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const $ = id => document.getElementById(id);

  // ── Valg (huskes i browseren) ────────────────────────────────────────────
  let valgt = new Set(['k:kundenr', 'k:navn', 'k:omraade']);
  let krav = new Set();            // felter, der skal have tekst, før linjen kommer med
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s?.felter?.length) valgt = new Set(s.felter);
    if (Array.isArray(s?.krav)) krav = new Set(s.krav);
    if (s?.kravMode) $('exReqMode').value = s.kravMode;
    if (s?.niveau) document.querySelector(`input[name=exNiveau][value="${s.niveau}"]`).checked = true;
    if (s?.titel) $('exOverskrift').value = s.titel;
  } catch {}
  function gem() {
    try { localStorage.setItem(STORE, JSON.stringify({ felter: [...valgt], krav: [...krav], kravMode: $('exReqMode').value, niveau: niveau(), titel: $('exOverskrift').value })); } catch {}
  }
  const niveau = () => document.querySelector('input[name=exNiveau]:checked').value;

  function alleFelter() {
    return [...KUNDE_FELTER, ...PRODUKT_FELTER, ...optionKeys.map(optFelt), ...BLANK];
  }
  // Valgte felter i fast rækkefølge; produkt/options kun ved én linje pr. produkt
  function valgteFelter() {
    const prod = niveau() === 'produkt';
    return alleFelter().filter(f => valgt.has(f.id) && (prod || !(f.id.startsWith('p:') || f.id.startsWith('o:'))));
  }

  // Krav, der kan bruges på det valgte niveau (produkt/options kun ved én linje pr. produkt)
  function aktiveKrav() {
    const prod = niveau() === 'produkt';
    return alleFelter().filter(f => krav.has(f.id) && !f.blank && (prod || !(f.id.startsWith('p:') || f.id.startsWith('o:'))));
  }
  function renderKravRow() {
    const aktive = aktiveKrav();
    $('exReqRow').hidden = !aktive.length;
    $('exReqList').textContent = aktive.map(f => f.label).join(', ');
    $('exReqMode').hidden = aktive.length < 2;
  }

  function renderGroups() {
    const prod = niveau() === 'produkt';
    $('exOptFilterRow').hidden = !prod;
    const grupper = [
      ['Kunde', KUNDE_FELTER.filter(f => f.gruppe === 'Kunde'), true],
      ['Serviceaftale', KUNDE_FELTER.filter(f => f.gruppe === 'Serviceaftale'), true],
      ['Kemi rabat', KUNDE_FELTER.filter(f => f.gruppe === 'Kemi rabat'), true],
      ['Produkt', PRODUKT_FELTER, prod],
      ['Tomme kolonner', BLANK, true],
      ['Options', optionKeys.map(optFelt), prod]
    ];
    $('exGroups').innerHTML = grupper.map(([navn, felter, on]) => {
      const kanKrav = on && navn !== 'Tomme kolonner';
      const nKrav = felter.filter(f => krav.has(f.id)).length;
      const reqUi = kanKrav ? `
        <span class="exReqWrap">
          <button type="button" class="exReqBtn${nKrav ? ' isSet' : ''}" data-req="${esc(navn)}" title="Vælg felter, der skal have tekst, før linjen kommer med">Skal være udfyldt${nKrav ? ` (${nKrav})` : ''} ▾</button>
          <div class="exReqPop" hidden>
            <div class="exReqHead">Kun linjer, hvor der står noget i:</div>
            ${felter.map(f => `<label><input type="checkbox" data-krav="${esc(f.id)}"${krav.has(f.id) ? ' checked' : ''}> ${esc(f.title || f.label)}</label>`).join('')}
          </div>
        </span>` : '';
      return `
      <div class="exGroup${on ? '' : ' disabled'}${navn === 'Options' ? ' options' : ''}" data-g="${esc(navn)}">
        <h4>${esc(navn)}${on
          ? `<span class="exGroupBtns">${reqUi}<button type="button" data-all="${esc(navn)}">Markér alle / ingen</button></span>`
          : '<span style="text-transform:none;letter-spacing:0">kræver "én linje pr. produkt"</span>'}</h4>
        <div class="${navn === 'Options' ? 'exOptList' : ''}">
          ${felter.map(f => `<label><input type="checkbox" value="${esc(f.id)}"${valgt.has(f.id) ? ' checked' : ''}${on ? '' : ' disabled'}> ${esc(f.title || f.label)}${krav.has(f.id) && on ? '<span class="exReqMark" title="Skal være udfyldt">*</span>' : ''}</label>`).join('')}
        </div>
      </div>`;
    }).join('');
    renderKravRow();

    // "Skal være udfyldt"-rullelisterne
    $('exGroups').querySelectorAll('[data-req]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const pop = b.nextElementSibling;
      const var_aaben = !pop.hidden;
      $('exGroups').querySelectorAll('.exReqPop').forEach(p => p.hidden = true);
      pop.hidden = var_aaben;
    });
    $('exGroups').querySelectorAll('.exReqPop').forEach(pop => pop.addEventListener('click', e => e.stopPropagation()));
    $('exGroups').querySelectorAll('input[data-krav]').forEach(cb => cb.onchange = () => {
      cb.checked ? krav.add(cb.dataset.krav) : krav.delete(cb.dataset.krav);
      gem();
      // Opdater knap, stjerner og kravlinjen uden at lukke rullelisten
      const grp = cb.closest('.exGroup');
      const n = grp.querySelectorAll('input[data-krav]:checked').length;
      const btn = grp.querySelector('.exReqBtn');
      btn.classList.toggle('isSet', n > 0);
      btn.textContent = `Skal være udfyldt${n ? ` (${n})` : ''} ▾`;
      const lbl = grp.querySelector(`input[type=checkbox][value="${CSS.escape(cb.dataset.krav)}"]`)?.closest('label');
      if (lbl) {
        lbl.querySelector('.exReqMark')?.remove();
        if (cb.checked) lbl.insertAdjacentHTML('beforeend', '<span class="exReqMark" title="Skal være udfyldt">*</span>');
      }
      renderKravRow();
    });
    $('exGroups').querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => {
      cb.checked ? valgt.add(cb.value) : valgt.delete(cb.value);
      gem();
    });
    $('exGroups').querySelectorAll('[data-all]').forEach(b => b.onclick = () => {
      const boxes = [...b.closest('.exGroup').querySelectorAll('input[type=checkbox]')];
      const alle = boxes.every(cb => cb.checked);
      boxes.forEach(cb => { cb.checked = !alle; alle ? valgt.delete(cb.value) : valgt.add(cb.value); });
      gem();
    });
  }

  function msg(text, cls = '') { const el = $('exMsg'); el.className = 'msg ' + cls; el.textContent = text; }

  function open() {
    const n = filtered.length;
    $('exInfo').textContent = `${n} kunde${n === 1 ? '' : 'r'} fra listen (din søgning og dine filtre gælder)`;
    msg('');
    renderGroups();
    wrap.hidden = false;
  }
  function close() { wrap.hidden = true; }

  // ── Data ─────────────────────────────────────────────────────────────────
  async function loadProdukter() {
    if (produkter) return produkter;
    msg('Henter produkter og options…');
    const r = await fetch('/api/kunde-produkter', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    produkter = j.produkter || [];
    // Nye options i data (ikke i listen) kommer med til sidst
    const extra = new Set();
    const kendte = new Set(optionKeys.map(normKey));
    produkter.forEach(p => Object.keys(p.udstyr || {}).forEach(k => { if (!kendte.has(normKey(k))) { kendte.add(normKey(k)); extra.add(k); } }));
    if (extra.size) { optionKeys = [...optionKeys, ...[...extra].sort((a, b) => a.localeCompare(b, 'da'))]; renderGroups(); }
    msg('');
    return produkter;
  }

  // → { title, fields, rows: [[værdi, …]], count, unit }
  async function build() {
    const fields = valgteFelter();
    if (!fields.length) throw new Error('Vælg mindst én kolonne');
    if (fields.some(f => f.id.startsWith('k:sa_')) && !saByKunde) {
      // Serviceaftaler hentes, selv om kolonnerne ikke vises i listen
      const r = await fetch('/api/kunde-serviceaftaler', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      buildSaMap(j.items || []);
    }
    if (fields.some(f => f.id.startsWith('k:rb_'))) await ensureRbFor(fields);
    const title = $('exOverskrift').value.trim() || 'Kundeliste';
    const kunder = [...filtered];

    const kravFelter = aktiveKrav();
    if (kravFelter.some(f => f.id.startsWith('k:sa_')) && !saByKunde) {
      const r = await fetch('/api/kunde-serviceaftaler', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      buildSaMap(j.items || []);
    }
    if (kravFelter.some(f => f.id.startsWith('k:rb_'))) await ensureRbFor();
    const alleKrav = $('exReqMode').value !== 'mindst';
    const harTekst = (f, k, p) => String(f.value(k, p) ?? '').trim() !== '';
    const opfylder = (k, p) => !kravFelter.length ||
      (alleKrav ? kravFelter.every(f => harTekst(f, k, p)) : kravFelter.some(f => harTekst(f, k, p)));

    if (niveau() === 'kunde') {
      const rows = udenTomme(fields, kunder.filter(k => opfylder(k)).map(k => fields.map(f => f.blank ? '' : f.value(k))));
      return { title, fields, unit: 'kunde', count: rows.length, rows };
    }

    const alle = await loadProdukter();
    const byNr = new Map();
    alle.forEach(p => { if (!byNr.has(p.kundenr)) byNr.set(p.kundenr, []); byNr.get(p.kundenr).push(p); });
    const optFields = fields.filter(f => f.option);
    const kunMed = $('exKunMedOption').checked && optFields.length;
    const rows = [];
    for (const k of kunder) {
      const list = (byNr.get(String(k.kundenr).trim()) || [])
        .slice().sort((a, b) => a.produkt.localeCompare(b.produkt, 'da') || a.serienr.localeCompare(b.serienr, 'da', { numeric: true }));
      for (const p of list) {
        if (kunMed && !optFields.some(f => String(udstyrVal(p, f.option) ?? '').trim())) continue;
        if (!opfylder(k, p)) continue;
        rows.push(fields.map(f => f.blank ? '' : f.value(k, p)));
      }
    }
    const ikkeTomme = udenTomme(fields, rows);
    return { title, fields, rows: ikkeTomme, unit: 'produkt', count: ikkeTomme.length };
  }

  // Fjern linjer, hvor alle valgte kolonner er tomme (fx kun "INFO Mail-adresse"
  // valgt, og kunden har ingen mail). Tomme afkrydsnings-/bemærkningskolonner
  // tæller ikke med. Er der KUN tomme kolonner valgt, beholdes alle linjer.
  function udenTomme(fields, rows) {
    const idx = fields.map((f, i) => f.blank ? -1 : i).filter(i => i >= 0);
    if (!idx.length) return rows;
    return rows.filter(r => idx.some(i => String(r[i] ?? '').trim() !== ''));
  }
  const antalTekst = d => `${d.count} ${d.unit === 'kunde' ? (d.count === 1 ? 'kunde' : 'kunder') : (d.count === 1 ? 'produkt' : 'produkter')}`;

  async function run(btn, fn) {
    const btns = ['exCopy', 'exExcel', 'exPrint'].map($);
    btns.forEach(b => b.disabled = true);
    try { await fn(); }
    catch (e) { msg('Fejl: ' + (e.message || e), 'err'); }
    finally { btns.forEach(b => b.disabled = false); }
  }

  // ── Kopiér (tabulator-adskilt med overskrifter) ──────────────────────────
  async function kopier() {
    const d = await build();
    const fields = d.fields.filter(f => !f.blank);
    const idx = d.fields.map((f, i) => f.blank ? -1 : i).filter(i => i >= 0);
    const text = [fields.map(f => f.label).join('\t'), ...d.rows.map(r => idx.map(i => r[i]).join('\t'))].join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
      wrap.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      if (!ok) throw new Error('Browseren tillod ikke kopiering');
    }
    msg(`Kopieret ✓ (${antalTekst(d)})`, 'ok');
  }

  // ── Excel (ExcelJS hentes første gang) ───────────────────────────────────
  let excelJs = null;
  function loadExcelJs() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (!excelJs) {
      excelJs = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
        sc.onload = () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS blev ikke indlæst'));
        sc.onerror = () => reject(new Error('Kunne ikke hente Excel-biblioteket'));
        document.head.appendChild(sc);
      });
      excelJs.catch(() => { excelJs = null; });
    }
    return excelJs;
  }

  async function excel() {
    const lib = loadExcelJs();
    const d = await build();
    msg('Laver Excel-fil…');
    const ExcelJS = await lib;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Herrup Portalen';
    const ws = wb.addWorksheet(d.title.replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Kundeliste');
    ws.getCell('A1').value = d.title;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = `${new Date().toLocaleDateString('da-DK')} · ${antalTekst(d)}`;
    ws.getCell('A2').font = { color: { argb: 'FF6B7280' } };

    const seen = new Map();
    const headers = d.fields.map(f => {
      const h = f.id === 'b:kryds' ? 'Afkrydsning' : f.label;
      const n = (seen.get(h) || 0) + 1; seen.set(h, n);
      return n > 1 ? `${h} ${n}` : h;
    });
    const headerRow = 4;
    ws.addTable({
      name: 'Kundeliste', ref: `A${headerRow}`, headerRow: true,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: headers.map(h => ({ name: h, filterButton: true })),
      rows: d.rows.length ? d.rows : [headers.map(() => '')]
    });
    d.fields.forEach((f, i) => {
      const longest = Math.max(Math.min(headers[i].length, 30), ...d.rows.map(r => String(r[i] || '').length));
      const col = ws.getColumn(i + 1);
      col.width = f.blank ? (f.id === 'b:kryds' ? 12 : 30) : Math.min(50, Math.max(f.option ? 8 : 10, longest + 2));
      col.alignment = { vertical: 'top', wrapText: true };
    });
    ws.getCell('A1').alignment = { wrapText: false };
    ws.getCell('A2').alignment = { wrapText: false };
    ws.views = [{ state: 'frozen', ySplit: headerRow }];
    ws.pageSetup = { orientation: d.fields.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: `${headerRow}:${headerRow}` };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fileName = `${d.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Kundeliste'} ${new Date().toISOString().slice(0, 10)}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    msg(`Excel-fil hentet ✓ (${antalTekst(d)}) – åbn "${fileName}" fra overførsler`, 'ok');
  }

  // ── Udskriv (eget vindue, så kundelistens layout ikke spiller ind) ───────
  async function udskriv() {
    const w = window.open('', '_blank');           // åbnes i klikket, så popup-blokering undgås
    if (!w) throw new Error('Browseren blokerede udskriftsvinduet – tillad popups for siden');
    w.document.write('<p style="font-family:sans-serif">Forbereder udskrift…</p>');
    let d;
    try { d = await build(); } catch (e) { w.close(); throw e; }
    const synlige = d.fields.filter(f => !f.blank).length;
    const landscape = synlige > 6;
    const small = synlige > 10;
    w.document.open();
    w.document.write(`<!doctype html><html lang="da"><head><meta charset="utf-8"><title>${esc(d.title)}</title>
      <style>
        @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
        body { font-family: "Segoe UI", Arial, sans-serif; color:#111; margin:0; }
        .head { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #a00018; padding-bottom:6px; margin-bottom:8px; }
        .title { font-size:18px; font-weight:700; }
        .meta { font-size:11px; color:#555; }
        table { width:100%; border-collapse:collapse; font-size:${small ? '9px' : '11px'}; }
        thead { display:table-header-group; }
        th { text-align:left; background:#f3f4f6; border:1px solid #d1d5db; padding:4px 5px; vertical-align:bottom; }
        td { border:1px solid #e5e7eb; padding:4px 5px; vertical-align:top; }
        tr { page-break-inside:avoid; }
        td.num { text-align:right; color:#6b7280; width:1%; }
        th.opt { writing-mode:vertical-rl; transform:rotate(180deg); white-space:nowrap; max-height:120px; font-weight:600; }
        td.opt { text-align:center; }
      </style></head><body>
      <div class="head"><div class="title">${esc(d.title)}</div><div class="meta">${new Date().toLocaleDateString('da-DK')} · ${antalTekst(d)}</div></div>
      <table>
        <thead><tr><th>#</th>${d.fields.map(f => `<th${f.option ? ' class="opt"' : ''}${f.width ? ` style="width:${f.width}"` : ''}>${esc(f.label)}</th>`).join('')}</tr></thead>
        <tbody>${d.rows.map((r, i) => `<tr><td class="num">${i + 1}</td>${r.map((v, j) => `<td${d.fields[j].option ? ' class="opt"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <script>window.onload = () => setTimeout(() => window.print(), 150);<\/script>
      </body></html>`);
    w.document.close();
    msg(`Udskrift åbnet ✓ (${antalTekst(d)})`, 'ok');
  }

  // ── Knapper ──────────────────────────────────────────────────────────────
  document.querySelectorAll('input[name=exNiveau]').forEach(r => r.onchange = () => { gem(); renderGroups(); });
  $('exOverskrift').oninput = gem;
  $('exReqMode').onchange = gem;
  $('exReqClear').onclick = () => { krav.clear(); gem(); renderGroups(); };
  wrap.addEventListener('click', e => {
    if (!e.target.closest('.exReqWrap')) wrap.querySelectorAll('.exReqPop').forEach(p => p.hidden = true);
  });
  $('exClose').onclick = close;
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || wrap.hidden) return;
    const openPop = wrap.querySelector('.exReqPop:not([hidden])');
    if (openPop) openPop.hidden = true; else close();
  });
  $('exCopy').onclick = () => run($('exCopy'), kopier);
  $('exExcel').onclick = () => run($('exExcel'), excel);
  $('exPrint').onclick = () => run($('exPrint'), udskriv);

  window.openEksport = open;
})();
