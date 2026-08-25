/**
 * @module router
 * Minimal hash router: '#/templates/:id?record=abc'
 */
const routes = [];
let current = null;
let onLeave = null;

export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^\\/]+)'; }) + '\\/?$');
  routes.push({ re, keys, handler });
}

export function parseHash(hash = location.hash) {
  let h = hash.replace(/^#/, '') || '/';
  let query = {};
  const qi = h.indexOf('?');
  if (qi >= 0) {
    for (const [k, v] of new URLSearchParams(h.slice(qi + 1))) query[k] = v;
    h = h.slice(0, qi);
  }
  return { path: h, query };
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (replace) location.replace(target); else location.hash = path;
}

/** Register a callback that runs before leaving the current view (return false to cancel). */
export function setLeaveGuard(fn) { onLeave = fn; }

let lastHash = location.hash;
export async function dispatch() {
  if (onLeave) {
    const ok = await onLeave();
    if (ok === false) { history.replaceState(null, '', lastHash || '#/templates'); return; }
    onLeave = null;
  }
  lastHash = location.hash;
  const { path, query } = parseHash();
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      current = { path, params, query };
      try {
        await r.handler({ params, query, path });
      } catch (e) {
        console.error(e);
        const main = document.getElementById('main');
        if (main) main.innerHTML = `<div class="card"><h2>Something went wrong</h2><pre>${String(e && e.stack || e).replace(/</g, '&lt;')}</pre></div>`;
      }
      document.querySelectorAll('.topnav a').forEach((a) => {
        const seg = a.dataset.nav;
        a.classList.toggle('active', path === '/' + seg || path.startsWith('/' + seg + '/') || (seg === 'templates' && (path.startsWith('/interview') || path.startsWith('/output'))));
      });
      return;
    }
  }
  navigate('/templates', { replace: true });
}

export function currentRoute() { return current; }

export function start() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
