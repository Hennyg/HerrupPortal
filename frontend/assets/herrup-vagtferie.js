// assets/herrup-vagtferie.js
// Progressbar + preloading af vagt/ferie + simpel bro til fanen i herrup.html.

(function(){
  const CURRENT_YEAR = new Date().getFullYear();

  const state = {
    azure: 0,
    vagt: 0,
    azureDone: false,
    vagtDone: false,
    azureStarted: false,
    vagtStarted: false
  };

  function pct(n){
    return `${Math.max(0, Math.min(100, Math.round(n)))}%`;
  }

  function ensureProgressCard(){
    let el = document.getElementById('herrupLoadCard');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'herrupLoadCard';
    el.className = 'herrup-load-card';
    el.innerHTML = `
      <div class="herrup-load-title">Indlæser Herrup...</div>
      <div class="herrup-load-row">
        <div>Azure data</div>
        <div class="herrup-load-bar"><div id="herrupAzureFill" class="herrup-load-fill"></div></div>
        <div id="herrupAzurePct">0%</div>
      </div>
      <div class="herrup-load-row">
        <div>Vagt & ferie</div>
        <div class="herrup-load-bar"><div id="herrupVagtFill" class="herrup-load-fill"></div></div>
        <div id="herrupVagtPct">0%</div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function updateProgress(){
    const el = ensureProgressCard();
    const azureFill = document.getElementById('herrupAzureFill');
    const vagtFill = document.getElementById('herrupVagtFill');
    const azurePct = document.getElementById('herrupAzurePct');
    const vagtPct = document.getElementById('herrupVagtPct');

    if (azureFill) {
      azureFill.style.width = pct(state.azure);
      azureFill.classList.toggle('done', state.azureDone);
    }
    if (vagtFill) {
      vagtFill.style.width = pct(state.vagt);
      vagtFill.classList.toggle('done', state.vagtDone);
    }
    if (azurePct) azurePct.textContent = pct(state.azure);
    if (vagtPct) vagtPct.textContent = pct(state.vagt);

    if (state.azureDone && state.vagtDone) {
      el.classList.add('is-hidden');
    }
  }

  function startFakeProgress(key){
    const startedKey = `${key}Started`;
    if (state[startedKey]) return;
    state[startedKey] = true;

    const timer = setInterval(() => {
      if (state[`${key}Done`]) {
        clearInterval(timer);
        return;
      }
      state[key] = Math.min(92, state[key] + Math.max(1, (92 - state[key]) * 0.08));
      updateProgress();
    }, 180);
  }

  function markDone(key){
    state[key] = 100;
    state[`${key}Done`] = true;
    updateProgress();
  }

  function markFailed(key){
    state[key] = 100;
    state[`${key}Done`] = true;
    updateProgress();
  }

  function isAzureApi(url){
    const s = String(url || '').toLowerCase();
    if (!s.includes('/api/')) return false;
    if (s.includes('/api/vagtferieplan')) return false;
    return true;
  }

  function installFetchMonitor(){
    if (window.__herrupFetchMonitorInstalled) return;
    window.__herrupFetchMonitorInstalled = true;

    const originalFetch = window.fetch.bind(window);
    let azurePending = 0;

    window.fetch = async function(input, init){
      const url = typeof input === 'string' ? input : input?.url || '';

      if (String(url).includes('/api/vagtferieplan')) {
        startFakeProgress('vagt');
      } else if (isAzureApi(url)) {
        azurePending++;
        startFakeProgress('azure');
      }

      try {
        const res = await originalFetch(input, init);
        return res;
      } finally {
        if (String(url).includes('/api/vagtferieplan')) {
          markDone('vagt');
        } else if (isAzureApi(url)) {
          azurePending = Math.max(0, azurePending - 1);
          if (azurePending === 0) markDone('azure');
        }
      }
    };
  }

  async function preloadVagtFerie(){
    if (window.__vagtFeriePromise) return window.__vagtFeriePromise;

    startFakeProgress('vagt');
    window.__vagtFeriePromise = fetch(`/api/vagtferieplan?year=${CURRENT_YEAR}`, { cache:'no-store' })
      .then(async r => {
        const txt = await r.text();
        let data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
        if (!r.ok) throw new Error(data?.message || data?.error || `API fejl ${r.status}`);
        window.__vagtFerieData = data;
        markDone('vagt');
        return data;
      })
      .catch(err => {
        console.warn('Kunne ikke forudindlæse vagt/ferie:', err);
        markFailed('vagt');
        throw err;
      });

    return window.__vagtFeriePromise;
  }

  function findVisibleEmployeeName(){
    const selectors = [
      '[data-employee-name]',
      '#employeeName',
      '.employee-name',
      '.person-name',
      '.profile-name',
      'h1',
      'h2'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const txt = (el?.dataset?.employeeName || el?.textContent || '').trim();
      if (txt && txt.length < 80) return txt;
    }
    return '';
  }

  async function renderEmployeeVagtFerie(target, employeeName){
    if (!target) return;
    target.innerHTML = '<div class="vf-loading">Henter vagt og ferie...</div>';

    let data = window.__vagtFerieData;
    if (!data) {
      try { data = await preloadVagtFerie(); }
      catch(err) {
        target.innerHTML = `<div class="vf-error"><b>Kunne ikke hente vagt-/ferieplan.</b><br>${String(err.message || err)}</div>`;
        return;
      }
    }

    if (typeof window.renderVagtFerie !== 'function') {
      target.innerHTML = '<div class="vf-error">vagtferie.js er ikke indlæst.</div>';
      return;
    }

    window.renderVagtFerie(target, {
      year: CURRENT_YEAR,
      employee: employeeName || findVisibleEmployeeName(),
      view: 'person',
      data
    });
  }

  function autoAddSimpleTab(){
    const tabContainers = Array.from(document.querySelectorAll('.tabs, .tab-buttons, .profile-tabs, [role="tablist"]'));
    const tabContainer = tabContainers.find(x => /arbejde/i.test(x.textContent || '') && /privat/i.test(x.textContent || ''));
    if (!tabContainer || document.getElementById('herrupVagtFerieTabBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'herrupVagtFerieTabBtn';
    btn.type = 'button';
    btn.className = 'herrup-vf-tab-btn';
    btn.textContent = 'Vagt/Ferie';
    tabContainer.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'herrupVagtFeriePanel';
    panel.className = 'herrup-vf-panel';
    panel.hidden = true;
    tabContainer.parentElement.appendChild(panel);

    btn.addEventListener('click', () => {
      panel.hidden = false;
      btn.classList.add('active');
      renderEmployeeVagtFerie(panel, findVisibleEmployeeName());
    });
  }

  function installAutoTabObserver(){
    const obs = new MutationObserver(() => autoAddSimpleTab());
    obs.observe(document.documentElement, { childList:true, subtree:true });
    autoAddSimpleTab();
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureProgressCard();
    installFetchMonitor();
    startFakeProgress('azure');
    preloadVagtFerie().catch(() => {});
    installAutoTabObserver();

    window.addEventListener('load', () => {
      if (!state.azureDone) markDone('azure');
    });
  });

  window.herrupRenderVagtFerieForEmployee = renderEmployeeVagtFerie;
  window.herrupPreloadVagtFerie = preloadVagtFerie;
})();
