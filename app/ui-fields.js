/**
 * @module ui-fields
 * Renders one question (from questionnaire()) or model variable as an input widget.
 * Used by the interview, the record editor and the editor's sample-answers panel.
 *
 * Question = { path, label, type, required, options?, help?, listPath?, itemFields? }
 */
import { el, escapeHtml } from './components.js';
import { getPath, setPath, isAnswered } from './docgen.js';

let uid = 0;
const nextId = () => 'f' + (++uid);

/** Field name relative to a list item: itemFields may be given as 'Name' or 'Children.Name'. */
export function itemFieldName(field, listPath) {
  const p = field.path || field.name || '';
  if (listPath && p.startsWith(listPath + '[].')) return p.slice(listPath.length + 3);
  if (listPath && p.startsWith(listPath + '.')) return p.slice(listPath.length + 1);
  return p;
}

/** Generic form of a path: Children[0].Name → Children[].Name */
export function genericPath(p) { return String(p).replace(/\[\d+\]/g, '[]'); }

/** The top-level question path that owns `path` (Children[].Name → Children; Client.Name → Client.Name unless grouped). */
export function ownerOf(path, questions) {
  const g = genericPath(path);
  for (const q of questions) {
    if (q.path === g) return q;
    const isList = q.type === 'list', isObj = q.type === 'object';
    if (!isList && !isObj) continue;
    const prefix = isList ? q.path + '[].' : q.path + '.';
    if (!g.startsWith(prefix)) continue;
    const rel = g.slice(prefix.length);
    // Only own it if that field is actually asked inside this group.
    if ((q.itemFields || []).some((f) => itemFieldName(f, q.path) === rel)) return q;
  }
  return null;
}

/**
 * Shape the engine's flat question list for rendering:
 *  - "Children[].Name" questions become itemFields of the "Children" list question;
 *  - runs of questions sharing a dotted parent ("Client.FullName", "Client.IsMarried") become an
 *    object group with short labels, so the form reads as sections.
 */
export function groupQuestions(flat) {
  const out = [];
  const lists = new Map();
  for (const q of flat) {
    const li = q.path.indexOf('[].');
    if (li > 0) {
      const listPath = q.path.slice(0, li);
      let lq = lists.get(listPath);
      if (!lq) {
        lq = out.find((x) => x.type === 'list' && x.path === listPath);
        if (!lq) { lq = { path: listPath, label: humanizeLast(listPath), type: 'list', required: false, itemFields: [] }; out.push(lq); }
        lq.itemFields = lq.itemFields || [];
        lists.set(listPath, lq);
      }
      const rel = q.path.slice(li + 3);
      lq.itemFields.push({ ...q, path: rel, label: shortLabel(q.label, rel) });
      continue;
    }
    if (q.type === 'list') { const copy = { ...q, itemFields: q.itemFields ? q.itemFields.slice() : [] }; out.push(copy); lists.set(q.path, copy); continue; }
    out.push({ ...q });
  }
  // Object grouping by first path segment (only when 2+ questions share it and none is itself the parent).
  const grouped = [];
  const groups = new Map();
  for (const q of out) {
    const di = q.path.indexOf('.');
    if (di > 0 && q.type !== 'list') {
      const parent = q.path.slice(0, di);
      if (out.some((x) => x.path === parent)) { grouped.push(q); continue; }
      let g = groups.get(parent);
      if (!g) { g = { path: parent, label: humanizeLast(parent), type: 'object', itemFields: [] }; groups.set(parent, g); grouped.push(g); }
      g.itemFields.push({ ...q, path: q.path.slice(di + 1), label: shortLabel(q.label, q.path.slice(di + 1)) });
      continue;
    }
    grouped.push(q);
  }
  // Ungroup singletons so a lone "Attorney — Name" does not get its own section.
  return grouped.map((q) => (q.type === 'object' && q.itemFields.length === 1 ? { ...q.itemFields[0], path: q.path + '.' + q.itemFields[0].path, label: q.label + ' — ' + q.itemFields[0].label } : q));
}
/**
 * Lists whose items do not exist yet come back from the engine with no item fields; fill them from
 * the model (variables with listPath === list path) so the "Add" card knows what to ask.
 */
export function fillListFields(questions, model) {
  const vars = (model && model.variables) || {};
  for (const q of questions) {
    if (q.type !== 'list' || (q.itemFields && q.itemFields.length)) continue;
    q.itemFields = Object.values(vars)
      .filter((v) => v && !v.orphaned && v.type !== 'computed' && (v.listPath === q.path || (v.path || '').startsWith(q.path + '[].')))
      .map((v) => ({ path: itemFieldName(v, q.path), label: shortLabel(v.label, itemFieldName(v, q.path)), type: v.type || 'text', required: !!v.required, options: v.options, help: v.help }));
  }
  return questions;
}

/**
 * Update an already-rendered object group in place: remove fields that are no longer asked and
 * insert newly-relevant ones at the right position. Existing (possibly focused) inputs are untouched.
 */
export function patchGroup(groupNode, q, data, onChange, opts = {}) {
  const fs = groupNode.querySelector(':scope > fieldset');
  if (!fs) return false;
  const sub = getPath(data, q.path) || {};
  setPath(data, q.path, sub);
  const wanted = (q.itemFields || []).map((f) => ({ ...f, path: itemFieldName(f, q.path) }));
  const wantedPaths = new Set(wanted.map((f) => f.path));
  const existing = new Map([...fs.querySelectorAll(':scope > .q')].map((n) => [n.dataset.path, n]));
  for (const [p, n] of existing) if (!wantedPaths.has(p)) { n.classList.add('leaving'); setTimeout(() => n.remove(), 200); existing.delete(p); n.dataset.leaving = '1'; }
  let cursor = fs.querySelector(':scope > .q:not([data-leaving])');
  for (const f of wanted) {
    let n = existing.get(f.path);
    if (!n) { n = renderQuestion(f, sub, (p, v) => onChange(q.path + '.' + p, v), opts); fs.insertBefore(n, cursor); continue; }
    if (n !== cursor) fs.insertBefore(n, cursor); else cursor = nextField(cursor);
  }
  return true;
}
function nextField(n) { let x = n.nextElementSibling; while (x && (!x.classList.contains('q') || x.dataset.leaving)) x = x.nextElementSibling; return x; }

function humanizeLast(p) { const n = String(p).split('.').pop(); return n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
function shortLabel(label, rel) {
  if (!label) return humanizeLast(rel);
  const parts = String(label).split(' — ');
  return parts.length > 1 ? parts.slice(-rel.split('.').length).join(' — ') : label;
}

/**
 * Render a question. `data` is the root (or the list item) object. onChange(path, value) is
 * called with the *relative* path within `data` after every change.
 * opts: { compact, errors: Map<path,string> }
 */
export function renderQuestion(q, data, onChange, opts = {}) {
  const value = getPath(data, q.path);
  const id = nextId();
  const type = q.type || 'text';
  const wrap = el('div.q.field', { dataset: { path: q.path, type } });
  if (opts.errors && opts.errors.get(q.path)) wrap.classList.add('invalid');

  const labelEl = el('label', { for: id }, q.label || q.path, q.required ? el('span.req', { title: 'Required' }, '*') : null);
  if (type !== 'object' && type !== 'list') wrap.appendChild(labelEl);

  let control;
  const set = (v) => { setPath(data, q.path, v); onChange(q.path, v); };

  switch (type) {
    case 'longtext':
      control = el('textarea', { id, rows: opts.compact ? 2 : 4, value: value == null ? '' : value, onInput: (e) => set(e.target.value || undefined) });
      break;
    case 'number':
      control = el('input', { id, type: 'number', step: 'any', value: value == null ? '' : value, onInput: (e) => set(e.target.value === '' ? undefined : Number(e.target.value)) });
      break;
    case 'currency': {
      const input = el('input', {
        id, type: 'text', inputmode: 'decimal', placeholder: '0.00',
        value: value == null || value === '' ? '' : fmtMoneyInput(value),
        onFocus: (e) => { if (value != null) e.target.value = String(getPath(data, q.path) ?? ''); e.target.select(); },
        onInput: (e) => { const n = parseMoney(e.target.value); set(e.target.value.trim() === '' ? undefined : (isNaN(n) ? undefined : n)); },
        onBlur: (e) => { const n = parseMoney(e.target.value); e.target.value = isNaN(n) || e.target.value.trim() === '' ? '' : fmtMoneyInput(n); },
      });
      control = el('div.currency-wrap', input);
      break;
    }
    case 'date':
      control = el('input', { id, type: 'date', value: value || '', onInput: (e) => set(e.target.value || undefined) });
      break;
    case 'boolean': {
      const yes = el('button', { type: 'button', class: value === true ? 'on' : '', 'aria-pressed': value === true }, 'Yes');
      const no = el('button', { type: 'button', class: value === false ? 'on' : '', 'aria-pressed': value === false }, 'No');
      yes.addEventListener('click', () => { yes.classList.add('on'); no.classList.remove('on'); set(true); });
      no.addEventListener('click', () => { no.classList.add('on'); yes.classList.remove('on'); set(false); });
      control = el('div.segmented', { id, role: 'group', 'aria-labelledby': id + '-l' }, yes, no);
      labelEl.id = id + '-l'; labelEl.removeAttribute('for');
      break;
    }
    case 'selection': {
      const options = normOptions(q.options);
      if (options.length && options.length <= 5) {
        control = el('div.radios', { id, role: 'radiogroup' }, options.map((o) => el('label', el('input', {
          type: 'radio', name: id, value: o.value, checked: value === o.value, onChange: () => set(o.value),
        }), o.label)));
      } else {
        control = el('select', { id, onChange: (e) => set(e.target.value || undefined) },
          el('option', { value: '' }, options.length ? '— select —' : '— no options defined —'),
          options.map((o) => el('option', { value: o.value, selected: value === o.value }, o.label)));
      }
      break;
    }
    case 'multiselect': {
      const options = normOptions(q.options);
      const cur = Array.isArray(value) ? value.slice() : [];
      control = el('div.checks', { id }, options.map((o) => el('label', el('input', {
        type: 'checkbox', value: o.value, checked: cur.includes(o.value),
        onChange: (e) => {
          const arr = (getPath(data, q.path) || []).slice();
          const i = arr.indexOf(o.value);
          if (e.target.checked && i < 0) arr.push(o.value); else if (!e.target.checked && i >= 0) arr.splice(i, 1);
          set(arr.length ? arr : undefined);
        },
      }), o.label)));
      if (!options.length) control.appendChild(el('span.muted.small', 'No options defined for this variable.'));
      break;
    }
    case 'object': {
      const fs = el('fieldset.q-group', el('legend', q.label || q.path));
      const sub = getPath(data, q.path) || {};
      setPath(data, q.path, sub);
      for (const f of q.itemFields || []) {
        const rel = itemFieldName(f, q.path);
        fs.appendChild(renderQuestion({ ...f, path: rel }, sub, (p, v) => onChange(q.path + '.' + p, v), opts));
      }
      if (q.help) fs.appendChild(el('div.help.mb', q.help));
      wrap.appendChild(fs);
      return wrap;
    }
    case 'list': {
      wrap.appendChild(renderList(q, data, onChange, opts));
      return wrap;
    }
    case 'email':
      control = el('input', { id, type: 'email', value: value == null ? '' : value, onInput: (e) => set(e.target.value || undefined) });
      break;
    case 'phone':
      control = el('input', { id, type: 'tel', value: value == null ? '' : value, onInput: (e) => set(e.target.value || undefined) });
      break;
    case 'computed':
      control = el('input', { id, type: 'text', value: value == null ? '' : String(value), readonly: true, title: 'Computed automatically' });
      break;
    default:
      control = el('input', { id, type: 'text', value: value == null ? '' : value, onInput: (e) => set(e.target.value || undefined) });
  }
  wrap.appendChild(control);
  if (q.help) wrap.appendChild(el('div.help', q.help));
  if (opts.errors && opts.errors.get(q.path)) wrap.appendChild(el('div.error', opts.errors.get(q.path)));
  return wrap;
}

function renderList(q, data, onChange, opts) {
  const box = el('div.list-field');
  const head = el('div.flex', el('label', q.label || q.path, q.required ? el('span.req', '*') : null));
  box.appendChild(head);
  if (q.help) box.appendChild(el('div.help.mb', q.help));
  const itemsHost = el('div');
  box.appendChild(itemsHost);
  const fields = q.itemFields || [];

  function items() {
    let arr = getPath(data, q.path);
    if (!Array.isArray(arr)) { arr = []; setPath(data, q.path, arr); }
    return arr;
  }
  function commit() { onChange(q.path, items()); draw(); }
  function draw() {
    itemsHost.innerHTML = '';
    const arr = items();
    if (!arr.length) itemsHost.appendChild(el('div.muted.small.mb', 'None yet. Click "Add" to add one.'));
    arr.forEach((item, i) => {
      const card = el('div.list-item');
      const hd = el('div.list-item-head',
        el('span', `${singular(q.label || q.path)} ${i + 1}`), el('span.spacer'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Move up', disabled: i === 0, onClick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; commit(); } }, '↑'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Move down', disabled: i === arr.length - 1, onClick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; commit(); } }, '↓'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Remove', onClick: () => { arr.splice(i, 1); commit(); } }, 'Remove'),
      );
      card.appendChild(hd);
      if (!fields.length) {
        // No known fields: allow a single free-text value keyed "Value"
        card.appendChild(renderQuestion({ path: 'Value', label: 'Value', type: 'text' }, item, () => onChange(q.path, arr), opts));
      }
      for (const f of fields) {
        const rel = itemFieldName(f, q.path);
        card.appendChild(renderQuestion({ ...f, path: rel }, item, () => onChange(q.path, arr), opts));
      }
      itemsHost.appendChild(card);
    });
  }
  draw();
  box.appendChild(el('button.btn.btn-sm', { type: 'button', onClick: () => { items().push({}); commit(); } }, `+ Add ${singular(q.label || q.path).toLowerCase()}`));
  return box;
}

function singular(label) {
  const l = String(label);
  if (/ies$/i.test(l)) return l.replace(/ies$/i, 'y');
  if (/(ch|sh|ss|x)es$/i.test(l)) return l.replace(/es$/i, '');
  if (/s$/i.test(l) && !/ss$/i.test(l)) return l.slice(0, -1);
  return l;
}

export function normOptions(options) {
  if (!options) return [];
  const arr = Array.isArray(options) ? options : String(options).split(/[\n,]/);
  return arr.map((o) => {
    if (o == null || o === '') return null;
    if (typeof o === 'object') return { value: String(o.value ?? o.label), label: String(o.label ?? o.value) };
    const s = String(o).trim();
    return s ? { value: s, label: s } : null;
  }).filter(Boolean);
}

export function parseMoney(s) {
  return Number(String(s).replace(/[^0-9.-]/g, ''));
}
export function fmtMoneyInput(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Count answered / total for a list of questions (recursing into objects, not lists). */
export function progress(questions, data) {
  let total = 0, done = 0;
  const walk = (qs, scope) => {
    for (const q of qs) {
      if (q.type === 'object') { walk((q.itemFields || []).map((f) => ({ ...f, path: itemFieldName(f, q.path) })), getPath(scope, q.path) || {}); continue; }
      if (q.type === 'computed') continue;
      total++;
      if (isAnswered(getPath(scope, q.path))) done++;
    }
  };
  walk(questions, data);
  return { total, done };
}

export { escapeHtml };
