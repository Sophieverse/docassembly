/**
 * @module components
 * Tiny DOM helpers: el(), modal(), toast(), confirm(), prompt(), download(), debounce().
 */

/**
 * Create an element. el('div.card#id', {attrs}, ...children)
 * Children may be strings, nodes, arrays, or null.
 */
export function el(tag, attrs, ...children) {
  if (attrs && (typeof attrs === 'string' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const node = document.createElement(m[1] || 'div');
  if (m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') node.classList.add(part.slice(1));
      else node.id = part.slice(1);
    }
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') node.className += (node.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'html') node.innerHTML = v;
      else if (k in node && typeof v !== 'string' && k !== 'value') node[k] = v;
      else if (k === 'value') node.value = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else if (c instanceof Node) node.appendChild(c);
    else node.appendChild(document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = 300) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.cancel = () => clearTimeout(t);
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}

/* ---------- toasts ---------- */
export function toast(message, kind = '', ms = 3200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = el('div.toast', { class: kind, role: 'status' }, message);
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- modals ---------- */
/**
 * modal({title, body, buttons:[{label, primary, danger, value, onClick}], wide, onClose})
 * Returns { close(value), promise } — promise resolves to the button value (or null on dismiss).
 */
export function modal({ title = '', body = null, buttons = null, wide = false, closable = true } = {}) {
  const host = document.getElementById('modals');
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const box = el('div.modal', { class: wide ? 'wide' : '', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const backdrop = el('div.modal-backdrop', box);
  const prevFocus = document.activeElement;
  function close(value = null) {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    resolve(value);
  }
  function onKey(e) {
    if (e.key === 'Escape' && closable) { e.preventDefault(); close(null); }
    if (e.key === 'Tab') trapFocus(e, box);
  }
  const head = el('div.modal-head', title, closable ? el('button.btn.btn-ghost.btn-icon.close', { type: 'button', 'aria-label': 'Close', onClick: () => close(null) }, '×') : null);
  const bodyEl = el('div.modal-body', typeof body === 'string' ? el('p', body) : body);
  box.append(head, bodyEl);
  if (buttons && buttons.length) {
    const foot = el('div.modal-foot');
    for (const b of buttons) {
      foot.appendChild(el('button.btn', {
        type: 'button',
        class: b.primary ? 'btn-primary' : b.danger ? 'btn-danger' : '',
        onClick: async () => {
          if (b.onClick) { const r = await b.onClick(); if (r === false) return; }
          close(b.value !== undefined ? b.value : b.label);
        },
      }, b.label));
    }
    box.appendChild(foot);
  }
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && closable) close(null); });
  document.addEventListener('keydown', onKey);
  host.appendChild(backdrop);
  setTimeout(() => {
    const f = box.querySelector('input, textarea, select, button.btn-primary, button');
    if (f) f.focus();
  }, 0);
  return { close, promise, box, body: bodyEl };
}

function trapFocus(e, box) {
  const f = [...box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function confirm(message, { title = 'Please confirm', okLabel = 'OK', danger = false } = {}) {
  return modal({
    title, body: message,
    buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  }).promise.then((v) => v === true);
}

export function prompt(message, { title = '', value = '', placeholder = '', okLabel = 'OK', multiline = false } = {}) {
  const input = multiline
    ? el('textarea', { rows: 5, value, placeholder })
    : el('input', { type: 'text', value, placeholder });
  let result = null;
  const m = modal({
    title: title || message,
    body: el('div', title ? el('label', message) : null, input),
    buttons: [{ label: 'Cancel', value: null }, { label: okLabel, primary: true, value: 'ok', onClick: () => { result = input.value; } }],
  });
  if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); result = input.value; m.close('ok'); } });
  return m.promise.then((v) => (v === 'ok' ? result : null));
}

/* ---------- files ---------- */
export function download(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

/** Prompt for a file. Returns Promise<File|null>. */
export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.appendChild(input);
    input.click();
    // If the dialog is cancelled we never hear back; clean up later.
    setTimeout(() => { if (document.body.contains(input)) input.remove(); }, 60000);
  });
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

export function safeFilename(name, ext) {
  const base = String(name || 'document').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document';
  return ext ? `${base}.${ext}` : base;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtCurrency(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '';
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const ta = el('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
  return Promise.resolve();
}
