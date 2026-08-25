/**
 * @module ui-editor
 * #/templates/:id — template editor with live compile, variables table, logic map and live preview.
 */
import * as store from './store.js';
import { el, clear, toast, confirm, prompt, modal, download, debounce, safeFilename } from './components.js';
import { navigate } from './router.js';
import { compile, mergeModel, createModel, dependencyMap, questionnaire, humanize, functions } from './engine-api.js';
import { renderTemplate, labelFor, sampleValue, setPath } from './docgen.js';
import { renderQuestion, progress, groupQuestions, itemFieldName, fillListFields } from './ui-fields.js';
import { exportTemplate } from './ui-templates.js';

const TYPES = ['text', 'longtext', 'number', 'currency', 'date', 'boolean', 'selection', 'multiselect', 'email', 'phone', 'object', 'list', 'computed'];
const TYPE_LABELS = { text: 'Text', longtext: 'Long text', number: 'Number', currency: 'Currency', date: 'Date', boolean: 'Yes / No', selection: 'Selection', multiselect: 'Multi-select', email: 'Email', phone: 'Phone', object: 'Object (group)', list: 'List (repeating)', computed: 'Computed' };
const FILTERS = [
  ['upper', 'UPPER CASE'], ['lower', 'lower case'], ['title', 'Title Case'], ['capitalize', 'Capitalize first'], ['trim', 'Trim spaces'],
  ['currency', 'Currency ($1,234.00)'], ['number', 'Number (1,234)'], ['words', 'Number in words'], ['ordinal', 'Ordinal (3rd)'], ['ordinalwords', 'Ordinal words (third)'],
  ['format:"MMMM d, yyyy"', 'Date format'], ['default:"…"', 'Default if blank'], ['pluralize:"item","items"', 'Pluralize'], ['join:"and"', 'Join list'],
  ['possessive', "Possessive ('s)"], ['pronoun:"subject"', 'Pronoun'], ['initials', 'Initials'],
];

export function renderEditor(main, ctx) {
  clear(main);
  const id = ctx.params.id;
  const tpl = store.templates.get(id);
  if (!tpl) { main.appendChild(el('div.card', 'Template not found. ', el('a', { href: '#/templates' }, 'Back to templates'))); return; }
  if (!tpl.model) tpl.model = { variables: {}, order: [] };

  /* ---------- state ---------- */
  let compiled = compile(tpl.text || '');
  let sampleData = loadSample(id, tpl);
  let activeTab = sessionStorage.getItem('docassembly.editorTab') || 'variables';
  let lastVarKeys = '';
  let savedText = tpl.text || '';
  let dirty = false;

  /* ---------- header ---------- */
  const title = el('h1', tpl.name);
  const status = el('span.muted.small', 'Saved');
  const head = el('div.page-head',
    el('a.btn.btn-ghost.btn-sm', { href: '#/templates' }, '← Templates'),
    title, status,
    el('div.actions',
      el('button.btn', { type: 'button', onClick: rename }, 'Rename'),
      el('button.btn', { type: 'button', onClick: () => exportTemplate(store.templates.get(id)) }, 'Export'),
      el('button.btn', { type: 'button', title: 'Ctrl/⌘+S', onClick: () => save(true) }, 'Save'),
      el('button.btn.btn-primary', { type: 'button', onClick: () => { save(true); navigate(`/interview/${id}`); } }, 'Run questionnaire →'),
    ));
  main.appendChild(head);

  /* ---------- editor (left) ---------- */
  const ta = el('textarea.editor-textarea', { spellcheck: false, 'aria-label': 'Template text', value: tpl.text || '' });
  const gutter = el('div.editor-gutter', { 'aria-hidden': 'true' });
  const errBox = el('div.errors.hidden');
  const statusBar = el('div.editor-status');
  const toolbar = el('div.editor-toolbar',
    el('button.btn.btn-sm', { type: 'button', onClick: insertField, title: 'Insert a merge field (Ctrl/⌘+Shift+F)' }, 'Insert field'),
    el('button.btn.btn-sm', { type: 'button', onClick: insertIf }, 'If / Else / End if'),
    el('button.btn.btn-sm', { type: 'button', onClick: insertList }, 'List'),
    el('button.btn.btn-sm', { type: 'button', onClick: () => wrapSelection('{[# ', ' ]}', 'note to drafter') }, 'Comment'),
    el('button.btn.btn-sm', { type: 'button', onClick: insertFilter }, 'Filter ▾'),
    el('span.grow'),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => wrapSelection('**', '**', 'bold') }, el('b', 'B')),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => wrapSelection('*', '*', 'italic') }, el('i', 'I')),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => wrapSelection('__', '__', 'underline') }, el('u', 'U')),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Heading', onClick: () => linePrefix('## ') }, 'H'),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Page break', onClick: () => insertText('\n---\n') }, '⤓ Page'),
  );
  const left = el('div.editor-left', toolbar, el('div.editor-wrap', gutter, ta), errBox, statusBar);

  /* ---------- right panel ---------- */
  const tabBody = el('div.tab-body');
  const tabs = el('div.tabs', ['variables', 'logic', 'preview'].map((t) => el('button', { type: 'button', dataset: { tab: t }, class: activeTab === t ? 'active' : '', onClick: () => switchTab(t) }, { variables: 'Variables', logic: 'Logic map', preview: 'Preview' }[t])));
  const right = el('div.editor-right', el('div.panel', tabs, tabBody));
  main.appendChild(el('div.editor-layout', left, right));

  /* ---------- editor behaviours ---------- */
  function updateGutter(errLines = new Set(), hl = -1) {
    const n = (ta.value.match(/\n/g) || []).length + 1;
    const parts = [];
    for (let i = 1; i <= n; i++) {
      const cls = errLines.has(i) ? 'ln-err' : i === hl ? 'ln-hl' : '';
      parts.push(cls ? `<span class="${cls}">${i}</span>` : String(i));
    }
    gutter.innerHTML = parts.join('\n');
    gutter.scrollTop = ta.scrollTop;
  }
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); insertField(); }
    if (e.key === 'Tab') { e.preventDefault(); insertText('  '); }
  });
  ta.addEventListener('input', () => { dirty = true; status.textContent = 'Editing…'; updateGutter(); recompile(); autosave(); });

  const autosave = debounce(() => save(false), 1200);
  function save(explicit) {
    const text = ta.value;
    if (text === savedText && !explicit && !dirty) return;
    store.templates.update(id, { text, model: tpl.model });
    savedText = text; dirty = false;
    status.textContent = 'Saved';
    if (explicit) toast('Template saved', 'ok', 1200);
  }

  const recompile = debounce(() => {
    compiled = compile(ta.value);
    const errs = compiled.errors || [];
    const errLines = new Set(errs.map((e) => e.line).filter(Boolean));
    updateGutter(errLines);
    clear(errBox);
    if (errs.length) {
      errBox.classList.remove('hidden');
      for (const e of errs) errBox.appendChild(el('div', { onClick: () => gotoLine(e.line || 1, e.col) }, `${e.line ? `Line ${e.line}${e.col ? ':' + e.col : ''} — ` : ''}${e.message}`));
    } else {
      errBox.classList.add('hidden');
      try { tpl.model = mergeModel(tpl.model || { variables: {}, order: [] }, compiled.analysis); } catch (e) { console.warn('mergeModel failed', e); }
    }
    const nVars = Object.values(tpl.model.variables || {}).filter((v) => !v.orphaned).length;
    clear(statusBar);
    statusBar.append(el('span', `${(ta.value.match(/\n/g) || []).length + 1} lines`), el('span', `${nVars} variable${nVars === 1 ? '' : 's'}`),
      errs.length ? el('span', { style: { color: 'var(--danger)' } }, `${errs.length} syntax error${errs.length === 1 ? '' : 's'}`) : el('span', { style: { color: 'var(--ok)' } }, 'Compiles cleanly'));
    drawTab();
  }, 300);

  function gotoLine(line, col = 1) {
    const lines = ta.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    pos += Math.max(0, (col || 1) - 1);
    ta.focus();
    ta.setSelectionRange(pos, pos + (lines[line - 1] ? lines[line - 1].length - (col ? col - 1 : 0) : 0));
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 19;
    ta.scrollTop = Math.max(0, (line - 4) * lh);
    updateGutter(new Set((compiled.errors || []).map((e) => e.line)), line);
  }

  function insertText(text, selectFrom = null, selectTo = null) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.setRangeText(text, s, e, 'end');
    if (selectFrom != null) ta.setSelectionRange(s + selectFrom, s + (selectTo ?? selectFrom));
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }
  function wrapSelection(before, after, placeholder) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || placeholder;
    ta.setRangeText(before + sel + after, s, e, 'end');
    ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }
  function linePrefix(prefix) {
    const s = ta.selectionStart;
    const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
    ta.setRangeText(prefix, ls, ls, 'preserve');
    ta.setSelectionRange(s + prefix.length, s + prefix.length);
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }
  function knownVars() {
    return Object.values(tpl.model.variables || {}).filter((v) => !v.orphaned);
  }
  function insertField() {
    const input = el('input', { type: 'text', placeholder: 'Type a variable name, e.g. Client.FullName', autocomplete: 'off' });
    const list = el('div.picker-list');
    const vars = knownVars();
    const draw = () => {
      clear(list);
      const q = input.value.trim().toLowerCase();
      const matches = vars.filter((v) => !q || v.path.toLowerCase().includes(q) || (v.label || '').toLowerCase().includes(q));
      for (const v of matches) list.appendChild(el('button', { type: 'button', onClick: () => choose(v.path) }, el('code', v.path), el('span.muted.small', v.label || ''), el('span.badge', TYPE_LABELS[v.type] || v.type)));
      if (!matches.length) list.appendChild(el('div.muted.small', { style: { padding: '.5rem' } }, vars.length ? 'No matching variables.' : 'No variables yet — type a name above and press Enter.'));
    };
    const choose = (path) => { m.close(); insertText(`{[${path}]}`); };
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); choose(input.value.trim().replace(/\s+/g, '')); }
      if (e.key === 'ArrowDown') { const b = list.querySelector('button'); if (b) { e.preventDefault(); b.focus(); } }
    });
    list.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && e.target.nextElementSibling) { e.preventDefault(); e.target.nextElementSibling.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (e.target.previousElementSibling || input).focus(); }
    });
    draw();
    const m = modal({ title: 'Insert field', body: el('div', el('div.field', input, el('div.help', 'Use dots to group: Client.FullName, Client.Address.City. New names create new questions.')), list) });
  }
  function insertIf() {
    const vars = knownVars().filter((v) => v.type === 'boolean');
    const cond = vars.length ? vars[0].path : 'Condition';
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    const text = `{[if ${cond}]}${sel || 'text when true'}{[else]}text when false{[end if]}`;
    ta.setRangeText(text, s, e, 'end');
    ta.setSelectionRange(s + 5, s + 5 + cond.length);
    ta.focus(); ta.dispatchEvent(new Event('input'));
  }
  function insertList() {
    const text = '{[list Items]}\n- {[Name]}{[_punc]}\n{[end list]}';
    const s = ta.selectionStart;
    ta.setRangeText(text, s, ta.selectionEnd, 'end');
    ta.setSelectionRange(s + 7, s + 12);
    ta.focus(); ta.dispatchEvent(new Event('input'));
  }
  function insertFilter() {
    const list = el('div.picker-list', FILTERS.map(([f, label]) => el('button', { type: 'button', onClick: () => {
      m.close();
      // If cursor is inside a field just before "]}", append the filter; otherwise insert a template.
      const s = ta.selectionStart;
      const before = ta.value.slice(0, s);
      const open = before.lastIndexOf('{[');
      const close = before.lastIndexOf(']}');
      if (open > close && ta.value.slice(s).startsWith(']}')) insertText(`|${f}`);
      else if (open > close) { const end = ta.value.indexOf(']}', s); if (end >= 0) { ta.setRangeText(`|${f}`, end, end, 'end'); ta.dispatchEvent(new Event('input')); ta.focus(); } }
      else insertText(`{[Value|${f}]}`, 2, 7);
    } }, el('code', f), el('span.muted.small', label))));
    const m = modal({ title: 'Insert filter', body: el('div', el('p.muted.small', 'Place the cursor inside a field to add the filter to it, e.g. ', el('code', '{[Fee|currency]}')), list) });
  }

  async function rename() {
    const n = await prompt('Template name', { title: 'Rename template', value: tpl.name });
    if (n && n.trim()) {
      const desc = await prompt('Short description (optional)', { title: 'Description', value: tpl.description || '' });
      store.templates.update(id, { name: n.trim(), description: desc == null ? tpl.description : desc.trim() });
      tpl.name = n.trim(); title.textContent = tpl.name;
    }
  }

  /* ---------- tabs ---------- */
  function switchTab(t) {
    activeTab = t;
    sessionStorage.setItem('docassembly.editorTab', t);
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    lastVarKeys = '';
    drawTab();
  }
  function drawTab() {
    if (activeTab === 'variables') drawVariables();
    else if (activeTab === 'logic') drawLogic();
    else drawPreview();
  }

  /* ---------- Variables tab ---------- */
  function drawVariables() {
    const vars = tpl.model.variables || {};
    const order = (tpl.model.order || []).filter((p) => vars[p]).concat(Object.keys(vars).filter((p) => !(tpl.model.order || []).includes(p)));
    const keys = order.join('|');
    if (keys === lastVarKeys && tabBody.querySelector('table.vars')) return; // avoid clobbering an input being edited
    lastVarKeys = keys;
    clear(tabBody);
    if (!order.length) { tabBody.appendChild(el('p.muted', 'No variables yet. Add a field such as ', el('code', '{[Client.FullName]}'), ' to the template.')); return; }
    tabBody.appendChild(el('p.muted.small', 'Variables are discovered from the template. Edit labels, types and options here; changes are saved with the template.'));
    const table = el('table.vars', el('thead', el('tr', el('th', 'Variable'), el('th', 'Label'), el('th', 'Type'), el('th', { title: 'Required' }, 'Req.'), el('th', ''))));
    const tb = el('tbody');
    for (const path of order) {
      const v = vars[path];
      const row = el('tr', { class: v.orphaned ? 'orphan' : '' });
      const labelIn = el('input', { type: 'text', value: v.label || '', placeholder: labelFor(null, path), onChange: (e) => { v.label = e.target.value.trim(); changed(); } });
      const typeSel = el('select', TYPES.map((t) => el('option', { value: t, selected: (v.type || 'text') === t }, TYPE_LABELS[t])), { onChange: null });
      typeSel.addEventListener('change', () => { v.type = typeSel.value; changed(); redrawExtra(); });
      const req = el('input', { type: 'checkbox', checked: !!v.required, onChange: (e) => { v.required = e.target.checked; changed(); } });
      const more = el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Options, help text, default, formula', onClick: () => { extraRow.classList.toggle('hidden'); more.textContent = extraRow.classList.contains('hidden') ? '⋯' : '▴'; } }, '⋯');
      row.append(el('td.path', { title: v.orphaned ? 'No longer used in the template' : path }, path), el('td', labelIn), el('td', typeSel), el('td', req), el('td', more));
      const extraRow = el('tr.hidden', el('td', { colspan: 5 }));
      const extraCell = extraRow.firstChild;
      const redrawExtra = () => {
        clear(extraCell);
        const grid = el('div.var-extra');
        if (v.type === 'selection' || v.type === 'multiselect') {
          grid.appendChild(el('div', { style: { gridColumn: '1 / -1' } }, el('label', 'Options (one per line)'), el('textarea', { rows: 3, value: Array.isArray(v.options) ? v.options.map((o) => (typeof o === 'object' ? o.label : o)).join('\n') : (v.options || ''), onChange: (e) => { v.options = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); changed(); } })));
        }
        if (v.type === 'computed') {
          grid.appendChild(el('div', { style: { gridColumn: '1 / -1' } }, el('label', 'Formula (expression)'), el('input', { type: 'text', class: 'mono', placeholder: 'e.g. Fee * 1.1', value: v.formula || '', onChange: (e) => { v.formula = e.target.value.trim(); changed(); } })));
        }
        grid.appendChild(el('div', el('label', 'Help text'), el('input', { type: 'text', value: v.help || '', placeholder: 'Shown under the question', onChange: (e) => { v.help = e.target.value.trim(); changed(); } })));
        grid.appendChild(el('div', el('label', 'Default'), el('input', { type: 'text', value: v.default == null ? '' : String(v.default), onChange: (e) => { v.default = e.target.value === '' ? undefined : parseDefault(e.target.value, v.type); changed(); } })));
        if (v.orphaned) grid.appendChild(el('div', { style: { gridColumn: '1 / -1' } }, el('button.btn.btn-sm.btn-danger', { type: 'button', onClick: () => { delete vars[path]; tpl.model.order = (tpl.model.order || []).filter((p) => p !== path); changed(); lastVarKeys = ''; drawVariables(); } }, 'Remove orphaned variable')));
        extraCell.appendChild(grid);
      };
      redrawExtra();
      tb.append(row, extraRow);
    }
    table.appendChild(tb);
    tabBody.appendChild(table);
  }
  function parseDefault(s, type) {
    if (type === 'boolean') return /^(true|yes|y|1)$/i.test(s);
    if (type === 'number' || type === 'currency') { const n = Number(String(s).replace(/[^0-9.-]/g, '')); return isNaN(n) ? undefined : n; }
    if (type === 'multiselect') return s.split(',').map((x) => x.trim()).filter(Boolean);
    return s;
  }
  function changed() { dirty = true; status.textContent = 'Editing…'; autosave(); }

  /* ---------- Logic map tab ---------- */
  function drawLogic() {
    clear(tabBody);
    if (compiled.errors && compiled.errors.length) { tabBody.appendChild(el('p.muted', 'Fix the syntax errors to see the logic map.')); return; }
    let map;
    try { map = dependencyMap(compiled.ast); } catch (e) { tabBody.appendChild(el('p.muted', 'Logic map unavailable: ' + e.message)); return; }
    const entries = map instanceof Map ? [...map.entries()] : Object.entries(map || {});
    if (!entries.length) { tabBody.appendChild(el('p.muted', 'No conditions or lists yet. Use "If / Else / End if" in the toolbar to add one — the questionnaire will only ask for the variables inside when the condition holds.')); return; }
    tabBody.appendChild(el('p.muted.small', 'Which variables control which parts of the document. Click a line number to jump there.'));
    for (const [path, uses] of entries) {
      const v = (tpl.model.variables || {})[path];
      tabBody.appendChild(el('div.logic-var', el('code', path), ' ', el('span.muted.small', v && v.label ? `— ${v.label}` : ''), ' ', el('span.badge', v ? TYPE_LABELS[v.type] || v.type : '')));
      for (const u of uses || []) {
        tabBody.appendChild(el('div.logic-item',
          el('div', el('span.badge.badge-accent', u.kind === 'list' ? 'list' : 'if'), ' ', el('span.cond', u.condSrc || '')),
          el('div.lines.small', 'Gates ', u.endLine && u.endLine !== u.line ? `lines ${u.line}–${u.endLine}` : `line ${u.line}`, ' ',
            el('a', { href: '#', onClick: (e) => { e.preventDefault(); gotoLine(u.line); } }, 'jump →'))));
      }
    }
  }

  /* ---------- Preview tab ---------- */
  function drawPreview() {
    clear(tabBody);
    if (compiled.errors && compiled.errors.length) { tabBody.appendChild(el('p.muted', 'Fix the syntax errors to preview.')); return; }
    const answers = el('div.preview-answers');
    const doc = el('div.preview-doc');
    tabBody.appendChild(el('div.preview-layout', answers, doc));
    const redrawDoc = debounce(() => {
      const r = renderTemplate({ ...tpl, text: ta.value }, sampleData);
      clear(doc);
      if (r.warnings.length) doc.appendChild(el('div.warn-list.doc-warn.small', `${r.warnings.length} missing value${r.warnings.length === 1 ? '' : 's'}: `, r.warnings.slice(0, 8).join('; '), r.warnings.length > 8 ? '…' : ''));
      doc.appendChild(el('div.doc-host', { html: r.html || '<div class="doc"><p>(empty document)</p></div>' }));
    }, 150);
    const drawAnswers = () => {
      clear(answers);
      let qs = [];
      try { qs = fillListFields(groupQuestions(questionnaire(compiled.ast, sampleData, tpl.model) || []), tpl.model); } catch (e) { answers.appendChild(el('p.error', 'questionnaire(): ' + e.message)); }
      answers.appendChild(el('div.flex.mb', el('strong.small', 'Sample answers'), el('span.grow'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Fill every question with a sample value', onClick: () => { if (tpl.sampleAnswers) sampleData = JSON.parse(JSON.stringify(tpl.sampleAnswers)); else fillSamples(qs); persist(); drawAnswers(); redrawDoc(); } }, 'Fill'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => { sampleData = {}; persist(); drawAnswers(); redrawDoc(); } }, 'Clear')));
      if (!qs.length) answers.appendChild(el('p.muted.small', 'No questions.'));
      for (const q of qs) {
        answers.appendChild(renderQuestion(q, sampleData, () => { persist(); redrawDoc(); scheduleAnswers(); }, { compact: true }));
      }
    };
    // When a gating answer changes, questions appear/disappear — re-render the answers list (debounced so typing is not interrupted).
    const scheduleAnswers = debounce(() => {
      const focused = document.activeElement;
      if (focused && answers.contains(focused) && focused.tagName !== 'BUTTON') return; // don't yank focus from a text box
      drawAnswers();
    }, 400);
    const persist = () => { try { sessionStorage.setItem('docassembly.sample.' + id, JSON.stringify(sampleData)); } catch (e) { /* ignore */ } };
    drawAnswers();
    redrawDoc.flush();
  }
  function fillSamples(qs) {
    const fill = (list, scope) => {
      for (const q of list) {
        if (q.type === 'object') { const o = scope[q.path] || {}; scope[q.path] = o; fill((q.itemFields || []).map((f) => ({ ...f, path: itemFieldName(f, q.path) })), o); continue; }
        if (q.type === 'list') { const item = {}; fill((q.itemFields || []).map((f) => ({ ...f, path: itemFieldName(f, q.path) })), item); setPath(scope, q.path, [item, JSON.parse(JSON.stringify(item))]); continue; }
        if (q.type === 'computed') continue;
        let v = sampleValue(q.type, q.path);
        if (q.type === 'selection' && q.options && q.options.length) v = typeof q.options[0] === 'object' ? q.options[0].value : q.options[0];
        if (q.type === 'multiselect' && q.options && q.options.length) v = [typeof q.options[0] === 'object' ? q.options[0].value : q.options[0]];
        setPath(scope, q.path, v);
      }
    };
    fill(qs, sampleData);
  }

  /* ---------- init ---------- */
  updateGutter();
  recompile.flush();
  window.onbeforeunload = () => (dirty ? true : undefined);
  ta.focus();
}

function loadSample(id, tpl) {
  try {
    const stored = sessionStorage.getItem('docassembly.sample.' + id);
    if (stored) return JSON.parse(stored);
  } catch (e) { /* ignore */ }
  return tpl && tpl.sampleAnswers ? JSON.parse(JSON.stringify(tpl.sampleAnswers)) : {};
}
