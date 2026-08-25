/**
 * @module ui-records
 * #/records and #/records/:id — client/matter records.
 */
import * as store from './store.js';
import { el, clear, toast, confirm, prompt, modal, download, pickFile, readFileText, fmtDate, safeFilename } from './components.js';
import { navigate } from './router.js';
import { renderQuestion } from './ui-fields.js';
import { labelFor } from './docgen.js';

export function renderRecords(main, ctx) {
  const id = ctx && ctx.params && ctx.params.id;
  if (id) return renderRecord(main, id);
  clear(main);
  const list = store.records.list();
  main.appendChild(el('div.page-head', el('h1', 'Records'), el('span.muted', `${list.length} record${list.length === 1 ? '' : 's'}`),
    el('div.actions',
      el('button.btn', { type: 'button', onClick: importRecords }, 'Import JSON'),
      el('button.btn.btn-primary', { type: 'button', onClick: async () => {
        const name = await prompt('Record name (client or matter)', { title: 'New record', placeholder: 'e.g. Smith, John — Estate plan' });
        if (name == null) return;
        const r = store.newRecord({ name: name.trim() || 'New record' });
        navigate(`/records/${r.id}`);
      } }, '+ New record'),
    )));

  if (!list.length) {
    main.appendChild(el('div.card.empty', el('h2', 'No records yet'), el('p', 'A record holds the answers for one client or matter. Records are created automatically when you save answers from a questionnaire, and can be reused across any template.'),
      el('a.btn.btn-primary', { href: '#/templates' }, 'Go to templates')));
    return;
  }
  const table = el('table.list', el('thead', el('tr', el('th', 'Name'), el('th.right', 'Answers'), el('th', 'Updated'), el('th', ''))));
  const tb = el('tbody');
  for (const r of list) {
    tb.appendChild(el('tr',
      el('td', el('a.rowlink', { href: `#/records/${r.id}` }, el('span.name', r.name))),
      el('td.right', String(countLeaves(r.data))),
      el('td.muted.nowrap', fmtDate(r.updatedAt)),
      el('td', el('div.actions',
        el('button.btn.btn-sm', { type: 'button', onClick: () => runWith(r) }, 'Run template…'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => navigate(`/records/${r.id}`) }, 'Open'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => { store.duplicate('records', r.id); renderRecords(main, {}); } }, 'Duplicate'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => download(safeFilename(r.name, 'record.json'), JSON.stringify(r, null, 2), 'application/json') }, 'Export'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', style: { color: 'var(--danger)' }, onClick: async () => {
          if (await confirm(`Delete record "${r.name}"?`, { okLabel: 'Delete', danger: true })) { store.records.remove(r.id); renderRecords(main, {}); }
        } }, 'Delete'),
      )),
    ));
  }
  table.appendChild(tb);
  main.appendChild(el('div.table-wrap', table));
}

function countLeaves(obj) {
  let n = 0;
  const walk = (v) => {
    if (v == null || v === '') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.values(v).forEach(walk); return; }
    n++;
  };
  walk(obj);
  return n;
}

function runWith(record) {
  const tpls = store.templates.list();
  const pkgs = store.packages.list();
  if (!tpls.length) { toast('No templates yet'); return; }
  const body = el('div.picker-list',
    tpls.map((t) => el('button', { type: 'button', onClick: () => { m.close(); navigate(`/interview/${t.id}?record=${record.id}`); } }, el('span', t.name))),
    pkgs.map((p) => el('button', { type: 'button', onClick: () => { m.close(); navigate(`/interview/pkg/${p.id}?record=${record.id}`); } }, el('span', p.name), el('span.badge', 'package'))),
  );
  const m = modal({ title: `Run with "${record.name}"`, body });
}

/** Union of all templates' model variables → question list (top-level, grouped into objects). */
export function unionQuestions(templates) {
  const vars = {};
  for (const t of templates) {
    const m = t.model && t.model.variables ? t.model.variables : {};
    for (const [path, v] of Object.entries(m)) {
      if (!v || v.orphaned || v.type === 'computed') continue;
      if (!vars[path]) vars[path] = { ...v, path, label: v.label || labelFor(t.model, path) };
      else if (!vars[path].options && v.options) vars[path].options = v.options;
    }
  }
  // Build tree: object/list parents with itemFields ("Children[].Name" belongs to list "Children")
  const paths = Object.keys(vars);
  const isChildOf = (p, parent) => p.startsWith(parent + '.') || p.startsWith(parent + '[].');
  const parents = paths.filter((p) => vars[p].type === 'object' || vars[p].type === 'list');
  const top = [];
  const consumed = new Set();
  const build = (path) => {
    const v = vars[path];
    const q = { path, label: v.label, type: v.type, required: !!v.required, options: v.options, help: v.help };
    if (v.type === 'object' || v.type === 'list') {
      q.itemFields = paths.filter((p) => isChildOf(p, path) && !parents.some((pp) => pp !== path && isChildOf(pp, path) && isChildOf(p, pp)))
        .map((p) => { consumed.add(p); return build(p); });
      if (v.type === 'list') q.listPath = path;
    }
    return q;
  };
  // Implicit objects: "Client.Name" with no "Client" variable → create group
  for (const p of paths.slice()) {
    const m = /^([^.\[]+)(\[\])?\./.exec(p);
    if (m) {
      const parent = m[1];
      if (!vars[parent]) { vars[parent] = { path: parent, type: m[2] ? 'list' : 'object', label: labelFor(null, parent) }; parents.push(parent); paths.push(parent); }
    }
  }
  for (const p of paths.sort()) {
    if (consumed.has(p)) continue;
    if (parents.some((pp) => pp !== p && isChildOf(p, pp))) continue;
    top.push(build(p));
  }
  return top;
}

function renderRecord(main, id) {
  clear(main);
  const r = store.records.get(id);
  if (!r) { main.appendChild(el('div.card', 'Record not found. ', el('a', { href: '#/records' }, 'Back to records'))); return; }
  const data = JSON.parse(JSON.stringify(r.data || {}));
  let dirty = false;
  const questions = unionQuestions(store.templates.list());

  const saveBtn = el('button.btn.btn-primary', { type: 'button', onClick: save }, 'Save');
  main.appendChild(el('div.page-head',
    el('a.btn.btn-ghost.btn-sm', { href: '#/records' }, '← Records'),
    el('h1', r.name),
    el('div.actions',
      el('button.btn', { type: 'button', onClick: async () => { const n = await prompt('New name', { title: 'Rename record', value: r.name }); if (n && n.trim()) { store.records.update(id, { name: n.trim() }); renderRecord(main, id); } } }, 'Rename'),
      el('button.btn', { type: 'button', onClick: () => runWith(r) }, 'Run template…'),
      el('button.btn', { type: 'button', onClick: () => download(safeFilename(r.name, 'record.json'), JSON.stringify({ ...r, data }, null, 2), 'application/json') }, 'Export'),
      saveBtn,
    )));

  const formHost = el('div');
  const jsonHost = el('div.hidden');
  const tabs = el('div.tabs',
    el('button', { type: 'button', class: 'active', onClick: (e) => switchTab(e, 'form') }, 'Answers'),
    el('button', { type: 'button', onClick: (e) => switchTab(e, 'json') }, 'Raw JSON'));
  main.appendChild(el('div.panel', tabs, el('div.panel-body', formHost, jsonHost)));

  const ta = el('textarea', { rows: 24, class: 'mono', value: JSON.stringify(data, null, 2) });
  const jsonErr = el('div.error');
  jsonHost.append(el('p.muted.small', 'Edit the answers directly. Dates are YYYY-MM-DD strings, money and numbers are plain numbers, Yes/No are true/false.'), ta, jsonErr);
  ta.addEventListener('input', () => {
    try { const v = JSON.parse(ta.value); Object.keys(data).forEach((k) => delete data[k]); Object.assign(data, v); jsonErr.textContent = ''; dirty = true; }
    catch (e) { jsonErr.textContent = 'Invalid JSON: ' + e.message; }
  });

  function drawForm() {
    clear(formHost);
    if (!questions.length) { formHost.appendChild(el('p.muted', 'No template variables are defined yet, so there is no form to show. Use the Raw JSON tab, or open a template first.')); return; }
    formHost.appendChild(el('p.muted.small', 'This form is the union of every variable used by your templates. Leave anything blank that does not apply.'));
    for (const q of questions) formHost.appendChild(renderQuestion(q, data, () => { dirty = true; ta.value = JSON.stringify(data, null, 2); }));
    // Extra keys not covered by any template
    const known = new Set(questions.map((q) => q.path.split('.')[0]));
    const extra = Object.keys(data).filter((k) => !known.has(k));
    if (extra.length) formHost.appendChild(el('p.muted.small', 'Other stored values (edit in Raw JSON): ', extra.map((k) => el('code', { style: { marginRight: '.3rem' } }, k))));
  }
  drawForm();

  function switchTab(e, which) {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.target));
    formHost.classList.toggle('hidden', which !== 'form');
    jsonHost.classList.toggle('hidden', which !== 'json');
    if (which === 'form') drawForm(); else ta.value = JSON.stringify(data, null, 2);
  }
  function save() {
    store.records.update(id, { data: JSON.parse(JSON.stringify(data)) });
    dirty = false;
    toast('Record saved', 'ok');
  }
  window.onbeforeunload = () => (dirty ? true : undefined);
}

async function importRecords() {
  const file = await pickFile('.json');
  if (!file) return;
  try {
    const parsed = JSON.parse(await readFileText(file));
    const items = Array.isArray(parsed) ? parsed : parsed.records ? Object.values(parsed.records) : [parsed];
    let n = 0;
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const rec = it.data ? it : { name: file.name.replace(/\.json$/i, ''), data: it };
      if (rec.id && store.records.get(rec.id)) delete rec.id;
      store.records.put({ ...rec, name: rec.name || 'Imported record' });
      n++;
    }
    toast(`Imported ${n} record${n === 1 ? '' : 's'}`, 'ok');
    location.reload();
  } catch (e) { toast('Invalid JSON: ' + (e.message || e), 'error'); }
}
