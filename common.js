async function initUser() {
  try {
    const r = await fetch('/.auth/me');
    const j = await r.json();
    const el = document.getElementById('userDisplay');
    if (el) el.textContent = j?.clientPrincipal?.userDetails || '';
  } catch {}
}
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return esc(s);
  return d.toLocaleDateString('da-DK');
}
function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return esc(s);
  return d.toLocaleString('da-DK', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function statusBadge(v) {
  const s = String(v || '').toLowerCase();
  const cls = s.includes('fejl') ? 'err' : s.includes('foreløbig') ? 'warn' : 'ok';
  return `<span class="badge ${cls}">${esc(v || 'OK')}</span>`;
}


