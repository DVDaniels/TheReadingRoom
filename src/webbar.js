// The web window's toolbar. It sits above the page in its own view and drives it through the app.
(() => {
  const T = window.__TAURI__, invoke = T.core.invoke, $ = id => document.getElementById(id);
  // the same theme as the app: it saves the choice where this toolbar can read it, and says when it changes
  const theme = () => { try { const t = JSON.parse(localStorage.getItem('readerPrefs') || '{}').theme; if (t && t !== 'auto') document.documentElement.dataset.theme = t; else document.documentElement.removeAttribute('data-theme'); } catch {} };
  theme(); window.addEventListener('storage', e => { if (e.key === 'readerPrefs') theme(); });
  const addr = $('addr'), lock = document.querySelector('.lock');
  let url = '', editing = false;
  const nav = (action, extra = {}) => invoke('web_nav', { action, ...extra }).catch(() => {});
  function show(s) {
    if (!s) return;
    url = s.url || url;
    document.body.classList.toggle('loading', !!s.loading);
    $('reload').title = s.loading ? 'Stop' : 'Reload (⌘R)';
    lock.style.visibility = url.startsWith('https:') ? 'visible' : 'hidden';
    if (!editing) addr.value = url;
  }
  addr.addEventListener('focus', () => { editing = true; addr.select(); });
  addr.addEventListener('blur', () => { editing = false; addr.value = url; });
  addr.addEventListener('keydown', e => { if (e.key === 'Escape') { addr.value = url; addr.blur(); } });
  $('go').addEventListener('submit', e => { e.preventDefault(); const v = addr.value.trim(); if (v) nav('go', { url: v }); addr.blur(); });
  $('back').onclick = () => nav('back');
  $('fwd').onclick = () => nav('forward');
  $('reload').onclick = () => nav(document.body.classList.contains('loading') ? 'stop' : 'reload');
  $('browser').onclick = () => nav('browser');
  $('follow').onclick = () => nav('follow');
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(url); } catch { const t = document.createElement('textarea'); t.value = url; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    $('copy').style.color = 'var(--accent)'; setTimeout(() => { $('copy').style.color = ''; }, 900);
  };
  document.addEventListener('keydown', e => {
    if (!e.metaKey) return;
    if (e.key === 'l') { e.preventDefault(); addr.focus(); }
    if (e.key === '[') { e.preventDefault(); nav('back'); }
    if (e.key === ']') { e.preventDefault(); nav('forward'); }
  });
  T.event.listen('web-state', e => show(e.payload));
  T.event.listen('app-theme', e => { const t = e.payload; if (t && t !== 'auto') document.documentElement.dataset.theme = t; else document.documentElement.removeAttribute('data-theme'); });
  invoke('web_state').then(show).catch(() => {});
})();
