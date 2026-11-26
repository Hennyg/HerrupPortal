// assets/kundeliste/hjaelp.js
// Hjælpetekster (?) i kundelisten. Teksterne vedligeholdes på kundeliste_admin.html
// (sektionen Hjælpetekster) og hentes sammen med kolonnegrupperne
// (/api/kundeliste-kolonner → hjaelp). Nøgler:
//   "kol:<kolonne-key>"  ved kolonneoverskrifter (KL_KOLONNER)
//   "el:<element-id>"    ved knapper og felter (KL_HJAELP_ELEMENTER)
(function () {
  window.KL_HJAELP = window.KL_HJAELP || {};

  const css = `
    .hlp { display:inline-flex; align-items:center; justify-content:center; width:17px; height:17px; min-width:17px;
           margin-left:5px; padding:0 !important; border-radius:50% !important; border:1.5px solid var(--red, #a00018) !important;
           background:#fff !important; color:var(--red, #a00018); font:700 11px/1 system-ui, sans-serif; cursor:pointer;
           vertical-align:middle; flex:0 0 auto; height:17px !important; }
    .hlp:hover { background:var(--red, #a00018) !important; color:#fff; }
    .hlpWrap { display:inline-flex; align-items:center; }
    .hlpPop { position:fixed; z-index:300; max-width:340px; background:#fff; border:1px solid #e5e7eb; border-top:4px solid var(--red, #a00018);
              border-radius:8px; box-shadow:0 12px 32px rgba(0,0,0,.2); padding:10px 12px; font-size:13px; line-height:1.45; color:#111; }
    .hlpPop[hidden] { display:none; }
    .hlpPop .hlpTitle { font-weight:700; margin-bottom:4px; padding-right:18px; }
    .hlpPop .hlpText { white-space:pre-wrap; }
    .hlpPop .hlpX { position:absolute; top:4px; right:6px; border:0; background:none; font-size:18px; line-height:1; cursor:pointer; color:#6b7280; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const pop = document.createElement('div');
  pop.className = 'hlpPop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = '<button type="button" class="hlpX" aria-label="Luk">×</button><div class="hlpTitle"></div><div class="hlpText"></div>';
  document.body.appendChild(pop);
  let openFor = null;

  const escAttr = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // HTML til en (?)-knap – tom streng, hvis nøglen ikke har nogen tekst
  window.klHelpIcon = function (key, title) {
    if (!String(window.KL_HJAELP[key] || '').trim()) return '';
    return `<button type="button" class="hlp" data-hlp="${escAttr(key)}" data-hlp-title="${escAttr(title || '')}" aria-label="Hjælp: ${escAttr(title || '')}" title="Forklaring">?</button>`;
  };

  // Sæt (?) ved knapper og felter. Har elementet en overskrift
  // (data-hlp-for="<id>"), kommer (?) i overskriften – ellers lige efter elementet.
  window.klApplyElementHelp = function () {
    document.querySelectorAll('.hlp[data-hlp^="el:"]').forEach(b => b.remove());
    (window.KL_HJAELP_ELEMENTER || []).forEach(({ id, label }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const html = window.klHelpIcon('el:' + id, label);
      if (!html) return;
      const heading = document.querySelector(`[data-hlp-for="${id}"]`);
      if (heading) heading.insertAdjacentHTML('beforeend', html);
      else el.insertAdjacentHTML('afterend', html);
    });
  };

  function show(btn) {
    const key = btn.dataset.hlp;
    if (openFor === btn && !pop.hidden) { hide(); return; }
    pop.querySelector('.hlpTitle').textContent = btn.dataset.hlpTitle || '';
    pop.querySelector('.hlpTitle').hidden = !btn.dataset.hlpTitle;
    pop.querySelector('.hlpText').textContent = window.KL_HJAELP[key] || '';
    pop.hidden = false;
    openFor = btn;
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function hide() { pop.hidden = true; openFor = null; }

  // Capture-fasen: klik på (?) må ikke sortere kolonnen eller åbne andet
  document.addEventListener('click', e => {
    const btn = e.target.closest('.hlp');
    if (btn) { e.preventDefault(); e.stopPropagation(); show(btn); return; }
    if (!pop.hidden && (e.target.closest('.hlpX') || !e.target.closest('.hlpPop'))) hide();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) hide(); });
  window.addEventListener('resize', hide);
  document.addEventListener('scroll', hide, true);
})();
