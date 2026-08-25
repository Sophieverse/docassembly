/**
 * @module ui-editor
 * #/templates/:id — template editor with live compile, variables table, logic map and live preview.
 */
import * as store from './store.js';
import { el, clear, toast, confirm, prompt, modal, download, debounce, safeFilename, pickFile, readFileBytes } from './components.js';
import { navigate, setLeaveGuard } from './router.js';
import { compile, mergeModel, createModel, dependencyMap, questionnaire, humanize, functions, ANNOTATION_KEYS, extractTemplateText } from './engine-api.js';
import { renderTemplate, labelFor, sampleValue, setPath, isWordTemplate, base64ToBytes, bytesToBase64 } from './docgen.js';
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
  const word = isWordTemplate(tpl); // Word-template mode: the .docx is the template; text here is read-only
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
  const ta = el('textarea.editor-textarea', { spellcheck: false, 'aria-label': 'Template text', value: tpl.text || '', readonly: word ? true : null, title: word ? 'Read-only: edit the tags in Word and replace the file' : null });
  const gutter = el('div.editor-gutter', { 'aria-hidden': 'true' });
  const errBox = el('div.errors.hidden');
  const warnBox = el('div.warn-list.annotation-warnings.hidden', { role: 'status' });
  const statusBar = el('div.editor-status');
  const toolbar = el('div.editor-toolbar',
    el('button.btn.btn-sm', { type: 'button', onClick: insertField, title: 'Insert a merge field (Ctrl/⌘+Shift+F)' }, 'Insert field'),
    el('button.btn.btn-sm', { type: 'button', onClick: insertIf }, 'If / Else / End if'),
    el('button.btn.btn-sm', { type: 'button', onClick: insertList }, 'List'),
    el('button.btn.btn-sm', { type: 'button', onClick: () => wrapSelection('{[# ', ' ]}', 'note to drafter') }, 'Comment'),
    el('button.btn.btn-sm', { type: 'button', onClick: insertFilter }, 'Filter ▾'),
    el('button.btn.btn-sm', { type: 'button', title: 'Set a label, help text, options or a validation rule from inside the template', onClick: insertAnnotation }, '@ Annotation'),
    el('span.grow'),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => wrapSelection('**', '**', 'bold') }, el('b', 'B')),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => wrapSelection('*', '*', 'italic') }, el('i', 'I')),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => wrapSelection('__', '__', 'underline') }, el('u', 'U')),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Heading', onClick: () => linePrefix('## ') }, 'H'),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Page break', onClick: () => insertText('\n---\n') }, '⤓ Page'),
  );
  const wordBanner = word ? el('div.banner.banner-info.word-banner', { role: 'status' },
    el('span.badge.badge-accent', 'Word template'), ' ',
    el('span', 'This is a Word template — ', el('code', tpl.docxName || 'original .docx'), '. The text below is read-only: edit the tags in Word, then '), el('strong', 'Replace Word file'), el('span', '. All Word formatting is preserved when the document is generated.'),
    el('span.grow'),
    el('button.btn.btn-sm', { type: 'button', onClick: replaceWordFile }, 'Replace Word file'),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: downloadOriginal }, 'Download original .docx')) : null;
  if (word) toolbar.querySelectorAll('button').forEach((b) => { b.disabled = true; b.title = 'Edit the tags in Word for a Word template'; });
  const left = el('div.editor-left', wordBanner, toolbar, el('div.editor-wrap', gutter, ta), errBox, warnBox, statusBar);

  /* ---------- right panel ---------- */
  const tabBody = el('div.tab-body');
  const tabs = el('div.tabs', { role: 'tablist' }, ['variables', 'logic', 'preview'].map((t) => el('button', { type: 'button', role: 'tab', 'aria-selected': activeTab === t ? 'true' : 'false', dataset: { tab: t }, class: activeTab === t ? 'active' : '', onClick: () => switchTab(t) }, { variables: 'Variables', logic: 'Logic map', preview: 'Preview' }[t])));
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
    if (text !== compiledText) recompile.flush(); // make sure the model matches the text being saved
    store.templates.update(id, { text, model: tpl.model });
    savedText = text; dirty = false;
    status.textContent = 'Saved';
    if (explicit) toast('Template saved', 'ok', 1200);
  }

  let compiledText = tpl.text || '';
  const recompile = debounce(() => {
    compiledText = ta.value;
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
      try { mergeInPlace(tpl.model, mergeModel(tpl.model, compiled.analysis)); } catch (e) { console.warn('mergeModel failed', e); }
    }
    // Annotation problems never stop compilation. Two sources: the parser (unknown key, bad regex … → errors)
    // and the model (type-aware checks from createModel/mergeModel, each with a severity). Shown with a line jump.
    const annErrs = [
      ...(((compiled.analysis && compiled.analysis.annotationErrors) || []).map((e) => ({ ...e, severity: e.severity || 'error' }))),
      ...(((tpl.model && tpl.model.annotationErrors) || []).map((e) => ({ ...e, severity: e.severity || 'warning' }))),
    ].filter((e, i, arr) => arr.findIndex((x) => x.message === e.message && x.line === e.line) === i)
      .sort((a, b) => (a.line || 0) - (b.line || 0));
    clear(warnBox);
    if (annErrs.length) {
      warnBox.classList.remove('hidden');
      for (const e of annErrs) warnBox.appendChild(el('div', { class: e.severity === 'warning' ? 'ann-warn' : 'ann-error', title: e.severity === 'warning' ? 'Warning' : 'Error', onClick: () => gotoLine(e.line || 1, e.col) },
        el('span.badge', { class: e.severity === 'warning' ? 'badge-warn' : 'badge-danger' }, e.severity === 'warning' ? 'warning' : 'error'), ' ',
        `${e.line ? `Line ${e.line}${e.col ? ':' + e.col : ''} — ` : ''}${e.path ? e.path + ': ' : ''}${e.message}`));
    } else warnBox.classList.add('hidden');
    const nVars = Object.values(tpl.model.variables || {}).filter((v) => !v.orphaned).length;
    clear(statusBar);
    statusBar.append(el('span', `${(ta.value.match(/\n/g) || []).length + 1} lines`), el('span', `${nVars} variable${nVars === 1 ? '' : 's'}`),
      errs.length ? el('span', { style: { color: 'var(--danger)' } }, `${errs.length} syntax error${errs.length === 1 ? '' : 's'}`) : el('span', { style: { color: 'var(--ok)' } }, 'Compiles cleanly'),
      ...(annErrs.length ? [el('span', { style: { color: annErrs.some((e) => e.severity !== 'warning') ? 'var(--danger)' : 'var(--warn)' } }, `${annErrs.length} annotation ${annErrs.length === 1 ? 'problem' : 'problems'}`)] : []));
    drawTab();
  }, 300);

  /** Apply a merged model without replacing the objects the Variables table is editing. */
  function mergeInPlace(model, merged) {
    if (!merged || merged === model) return;
    const vars = model.variables || (model.variables = {});
    const next = merged.variables || {};
    for (const k of Object.keys(vars)) if (!(k in next)) delete vars[k];
    for (const [k, v] of Object.entries(next)) {
      if (!vars[k]) { vars[k] = v; continue; }
      for (const key of Object.keys(vars[k])) if (!(key in v)) delete vars[k][key]; // e.g. a removed @annotation drops fromTemplate
      Object.assign(vars[k], v);
    }
    model.order = (merged.order || Object.keys(next)).slice();
    model.annotationErrors = Array.isArray(merged.annotationErrors) ? merged.annotationErrors.slice() : [];
  }

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

  /** Insert a `{[# @key Path: value]}` annotation comment on its own line. */
  function insertAnnotation() {
    const KEYS = [
      ['label', 'Question label', 'Client\'s full legal name'], ['help', 'Help text under the question', 'As it appears on the ID'],
      ['options', 'Pick-list (A | B | C)', 'Hourly | Flat | Contingency'], ['default', 'Default answer', 'California'],
      ['required', 'Required (no value) or "false"', ''], ['type', 'text, number, currency, date, boolean, selection, multiselect, email, phone, longtext, list, computed', 'currency'],
      ['min', 'Minimum (number or ISO date)', '0'], ['max', 'Maximum (number or ISO date)', '100'],
      ['minLength', 'Minimum characters / list items', '1'], ['maxLength', 'Maximum characters / list items', '10'],
      ['pattern', 'Regular expression', '^\\d{5}$'], ['validate', 'Rule expression :: message', 'value >= 1 :: Must be at least 1'],
      ['message', 'Custom error text for the rules', 'Please check this value'], ['formula', 'Computed value (never asked)', 'Fee * 1.1'],
    ];
    const keySel = el('select', { 'aria-label': 'Annotation' }, KEYS.map(([k, d]) => el('option', { value: k }, `@${k} — ${d}`)));
    const vars = knownVars();
    const dl = el('datalist', { id: 'ann-paths' }, vars.map((v) => el('option', { value: v.path })));
    const pathIn = el('input', { type: 'text', list: 'ann-paths', placeholder: 'Variable path, e.g. Client.FullName or Children[].DOB', autocomplete: 'off', value: vars.length ? vars[0].path : '' });
    const valIn = el('input', { type: 'text', placeholder: KEYS[0][2] });
    keySel.addEventListener('change', () => { const k = KEYS.find((x) => x[0] === keySel.value); valIn.placeholder = k ? k[2] : ''; valIn.disabled = keySel.value === 'required'; });
    const doInsert = () => {
      const key = keySel.value, path = pathIn.value.trim().replace(/\s+/g, '');
      if (!path) { pathIn.focus(); return false; }
      const value = valIn.value.trim() || (key === 'required' ? '' : (KEYS.find((x) => x[0] === key) || [])[2] || '');
      const line = `{[# @${key} ${path}${value ? ': ' + value : ''}]}`;
      const s0 = ta.selectionStart;
      const atLineStart = s0 === 0 || ta.value[s0 - 1] === '\n';
      const text = (atLineStart ? '' : '\n') + line + '\n';
      const vStart = text.indexOf(': ') >= 0 && value ? text.indexOf(': ') + 2 : null;
      insertText(text, vStart, vStart != null ? vStart + value.length : null);
      return true;
    };
    const m = modal({
      title: 'Insert annotation',
      body: el('div', el('p.muted.small', 'Annotations live in comments and shape the questionnaire without leaving the template. ', el('a', { href: '#/help', target: '_blank' }, 'Reference →')),
        el('div.field', el('label', 'Annotation'), keySel), el('div.field', el('label', 'Variable'), pathIn, dl), el('div.field', el('label', 'Value'), valIn)),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Insert', primary: true, value: 'ok', onClick: doInsert }],
    });
    valIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (doInsert()) m.close('ok'); } });
  }

  /** Word template: upload a new version of the .docx, re-extract the tag text and re-merge the model. */
  async function replaceWordFile() {
    const file = await pickFile('.docx');
    if (!file) return;
    try {
      const bytes = await readFileBytes(file);
      const text = await extractTemplateText(bytes);
      tpl.docxOrigin = bytesToBase64(bytes); tpl.docxName = file.name;
      store.templates.update(id, { docxOrigin: tpl.docxOrigin, docxName: tpl.docxName });
      ta.value = text;
      dirty = true; status.textContent = 'Editing…'; updateGutter();
      recompile.flush(); // mergeModel keeps labels/types the attorney set in the Variables tab
      save(true);
      wordBanner.querySelector('code').textContent = file.name;
      toast(`Replaced with ${file.name}`, 'ok');
    } catch (e) {
      console.error(e);
      toast('Could not read that .docx: ' + (e.message || e), 'error', 6000);
    }
  }
  function downloadOriginal() {
    try { download(tpl.docxName || safeFilename(tpl.name, 'docx'), new Blob([base64ToBytes(tpl.docxOrigin)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })); }
    catch (e) { toast('Could not decode the stored Word file: ' + (e.message || e), 'error', 6000); }
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
    tabs.querySelectorAll('button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'); });
    lastVarKeys = '';
    drawTab();
  }
  function drawTab() {
    if (activeTab === 'variables') drawVariables();
    else if (activeTab === 'logic') drawLogic();
    else drawPreview();
  }

  /* ---------- Variables tab ---------- */
  const RULE_FIELDS = ['min', 'max', 'minLength', 'maxLength', 'pattern', 'validate', 'message'];
  function markCustom(v, field) { v.custom = v.custom === true ? { [field]: true } : { ...(v.custom || {}), [field]: true }; }
  /** "from template" badge for a field set by an `@` annotation (hover shows the annotation). */
  function tplBadge(v, field) {
    if (!v.fromTemplate || !(field in v.fromTemplate)) return null;
    const raw = v.fromTemplate[field];
    const val = Array.isArray(raw) ? raw.join(' | ') : raw === true ? '' : String(raw);
    const edited = v.custom === true || (v.custom && v.custom[field] === true);
    return el('span.badge.badge-tpl', { title: `@${field} ${v.path}${val ? ': ' + val : ''}${edited ? ' — overridden here' : ''}`, dataset: { field } }, edited ? 'edited' : 'from template');
  }
  /** "Reset to template" — drop the user override for one field and re-merge so the annotation/inference wins again. */
  function resetBtn(v, field, path) {
    const edited = v.custom === true || (v.custom && v.custom[field] === true);
    if (!edited) return null;
    return el('button.btn.btn-sm.btn-ghost.reset-field', { type: 'button', title: v.fromTemplate && field in v.fromTemplate ? 'Reset to template' : 'Reset to inferred value', 'aria-label': `Reset ${field} of ${path}`, onClick: () => {
      v.custom = v.custom === true ? {} : { ...(v.custom || {}) };
      v.custom[field] = false; // explicit "not customized" so mergeModel takes the annotation / inference
      if (compiled.analysis && !(compiled.errors || []).length) { try { mergeInPlace(tpl.model, mergeModel(tpl.model, compiled.analysis)); } catch (e) { console.warn('mergeModel failed', e); } }
      changed(); lastVarKeys = ''; drawVariables();
    } }, '↺');
  }
  function drawVariables() {
    const vars = tpl.model.variables || {};
    const order = (tpl.model.order || []).filter((p) => vars[p]).concat(Object.keys(vars).filter((p) => !(tpl.model.order || []).includes(p)));
    const keys = order.map((p) => p + ':' + Object.keys((vars[p] && vars[p].fromTemplate) || {}).join(',')).join('|');
    if (keys === lastVarKeys && tabBody.querySelector('table.vars')) return; // avoid clobbering an input being edited
    lastVarKeys = keys;
    clear(tabBody);
    if (!order.length) { tabBody.appendChild(el('p.muted', 'No variables yet. Add a field such as ', el('code', '{[Client.FullName]}'), ' to the template.')); return; }
    const nTpl = order.filter((p) => vars[p].fromTemplate && Object.keys(vars[p].fromTemplate).length).length;
    tabBody.appendChild(el('p.muted.small', 'Variables are discovered from the template. Edit labels, types and options here; changes are saved with the template.',
      nTpl ? el('span', ' ', el('span.badge.badge-tpl', 'from template'), ` marks ${nTpl === 1 ? 'a setting' : 'settings'} made with an @annotation in the template; edits here win until you reset them (↺).`) : null));
    const table = el('table.vars', el('thead', el('tr', el('th', 'Variable'), el('th', 'Label'), el('th', 'Type'), el('th', { title: 'Required' }, 'Req.'), el('th', ''))));
    const tb = el('tbody');
    for (const path of order) {
      const v = vars[path];
      const row = el('tr', { class: v.orphaned ? 'orphan' : '' });
      const labelIn = el('input', { type: 'text', 'aria-label': `Label for ${path}`, value: v.label || '', placeholder: labelFor(null, path), onChange: (e) => { v.label = e.target.value.trim(); markCustom(v, 'label'); changed(); } });
      const typeSel = el('select', { 'aria-label': `Type of ${path}` }, TYPES.map((t) => el('option', { value: t, selected: (v.type || 'text') === t }, TYPE_LABELS[t])), { onChange: null });
      typeSel.addEventListener('change', () => { v.type = typeSel.value; markCustom(v, 'type'); changed(); redrawExtra(); });
      const req = el('input', { type: 'checkbox', 'aria-label': `${path} is required`, checked: !!v.required, onChange: (e) => { v.required = e.target.checked; markCustom(v, 'required'); changed(); } });
      const more = el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Options, help text, default, rules, formula', onClick: () => { extraRow.classList.toggle('hidden'); more.textContent = extraRow.classList.contains('hidden') ? '⋯' : '▴'; } }, '⋯');
      const hasRules = RULE_FIELDS.some((k) => v[k] !== undefined && v[k] !== null && v[k] !== '');
      row.append(
        el('td.path', { title: v.orphaned ? 'No longer used in the template' : path }, path, hasRules ? el('span.badge.badge-accent.ml', { title: 'Has validation rules' }, 'rules') : null),
        el('td', el('div.cell', labelIn, tplBadge(v, 'label'), resetBtn(v, 'label', path))),
        el('td', el('div.cell', typeSel, tplBadge(v, 'type'), resetBtn(v, 'type', path))),
        el('td', el('div.cell', req, tplBadge(v, 'required'), resetBtn(v, 'required', path))),
        el('td', more));
      const extraRow = el('tr.hidden', el('td', { colspan: 5 }));
      const extraCell = extraRow.firstChild;
      const field = (label, fieldName, input, span = false) => el('div', { style: span ? { gridColumn: '1 / -1' } : null }, el('label', label, ' ', tplBadge(v, fieldName), resetBtn(v, fieldName, path)), input);
      const redrawExtra = () => {
        clear(extraCell);
        const grid = el('div.var-extra');
        if (v.type === 'selection' || v.type === 'multiselect') {
          const inferred = Array.isArray(v.inferredOptions) ? v.inferredOptions.map((o) => (typeof o === 'object' ? o.label : o)) : [];
          const own = Array.isArray(v.options) ? v.options.map((o) => (typeof o === 'object' ? o.label : o)) : (v.options ? String(v.options).split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : []);
          grid.appendChild(field('Options (one per line)', 'options',
            el('div', el('textarea', { rows: 3, 'aria-label': `Options for ${path}`, value: own.join('\n'), placeholder: inferred.length ? inferred.join('\n') : 'One option per line', onChange: (e) => { v.options = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); markCustom(v, 'options'); changed(); } }),
              inferred.length && !own.length ? el('div.help.small', 'Found in the template: ', inferred.join(', '), ' — used unless you list your own.') : null), true));
        }
        if (v.type === 'computed') {
          grid.appendChild(field('Formula (expression)', 'formula', el('input', { type: 'text', class: 'mono', placeholder: 'e.g. Fee * 1.1', value: v.formula || '', onChange: (e) => { v.formula = e.target.value.trim(); markCustom(v, 'formula'); changed(); } }), true));
        }
        grid.appendChild(field('Help text', 'help', el('input', { type: 'text', value: v.help || '', placeholder: 'Shown under the question', onChange: (e) => { v.help = e.target.value.trim(); markCustom(v, 'help'); changed(); } })));
        grid.appendChild(field('Default', 'default', el('input', { type: 'text', value: v.default == null ? '' : (Array.isArray(v.default) ? v.default.join(', ') : String(v.default)), onChange: (e) => { v.default = e.target.value === '' ? undefined : parseDefault(e.target.value, v.type); markCustom(v, 'default'); changed(); } })));
        // Rules (collapsible)
        if (!['object', 'computed'].includes(v.type)) {
          const numeric = ['number', 'currency', 'date'].includes(v.type);
          const lengthy = !['boolean', 'selection', 'date', 'number', 'currency'].includes(v.type);
          const patterny = ['text', 'longtext', 'email', 'phone'].includes(v.type);
          const isList = v.type === 'list' || v.type === 'multiselect';
          const ruleGrid = el('div.var-rules');
          const num = (label, k, ph) => ruleGrid.appendChild(field(label, k, el('input', { type: v.type === 'date' ? 'date' : 'text', inputmode: 'decimal', class: 'mono', placeholder: ph, value: v[k] == null ? '' : String(v[k]), onChange: (e) => { const t = e.target.value.trim(); v[k] = t === '' ? undefined : (v.type === 'date' ? t : (isNaN(Number(t)) ? t : Number(t))); markCustom(v, k); changed(); } })));
          const int = (label, k) => ruleGrid.appendChild(field(label, k, el('input', { type: 'number', min: 0, step: 1, value: v[k] == null ? '' : String(v[k]), onChange: (e) => { const t = e.target.value.trim(); v[k] = t === '' ? undefined : Math.max(0, Math.floor(Number(t))); markCustom(v, k); changed(); } })));
          if (numeric) { num(v.type === 'date' ? 'Earliest date' : 'Minimum', 'min', v.type === 'date' ? '' : '0'); num(v.type === 'date' ? 'Latest date' : 'Maximum', 'max', v.type === 'date' ? '' : '100'); }
          if (lengthy) { int(isList ? 'Min items' : 'Min length', 'minLength'); int(isList ? 'Max items' : 'Max length', 'maxLength'); }
          if (patterny) ruleGrid.appendChild(field('Pattern (regular expression)', 'pattern', el('input', { type: 'text', class: 'mono', placeholder: '^\\d{5}(-\\d{4})?$', value: v.pattern || '', onChange: (e) => { const t = e.target.value; try { if (t) new RegExp(t); } catch (err) { toast('Invalid regular expression: ' + err.message, 'error'); } v.pattern = t || undefined; markCustom(v, 'pattern'); changed(); } }), true));
          ruleGrid.appendChild(field('Validation rule (expression; "value" is the answer)', 'validate', el('input', { type: 'text', class: 'mono', placeholder: isList ? 'e.g. sum(value, "Percent") = 100' : 'e.g. value >= Retainer * 2', value: v.validate || '', onChange: (e) => { v.validate = e.target.value.trim() || undefined; markCustom(v, 'validate'); changed(); } }), true));
          ruleGrid.appendChild(field('Error message (for the rules above)', 'message', el('input', { type: 'text', placeholder: 'Shown instead of the default message', value: v.message || '', onChange: (e) => { v.message = e.target.value.trim() || undefined; markCustom(v, 'message'); changed(); } }), true));
          const det = el('details.rules', { open: hasRules ? true : null }, el('summary', 'Rules', hasRules ? el('span.badge.badge-accent.ml', 'set') : null), ruleGrid);
          grid.appendChild(el('div', { style: { gridColumn: '1 / -1' } }, det));
        }
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
          el('div', el('span.badge.badge-accent', u.kind === 'list' ? 'list' : 'if'), ' ', el('span.cond', u.condSrc || u.condition || u.src || '')),
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
    if (word) tabBody.appendChild(el('p.muted.small', el('span.badge.badge-accent', 'Text preview'), ' Word formatting is not shown here; the generated document is your .docx with the tags filled in.'));
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
  // Leaving the editor (hash change): flush pending compile + autosave so nothing typed is lost.
  setLeaveGuard(() => {
    autosave.cancel(); recompile.cancel();
    if (dirty || ta.value !== savedText) save(false);
    window.onbeforeunload = null;
    return true;
  });
  ta.focus();
}

function loadSample(id, tpl) {
  try {
    const stored = sessionStorage.getItem('docassembly.sample.' + id);
    if (stored) return JSON.parse(stored);
  } catch (e) { /* ignore */ }
  return tpl && tpl.sampleAnswers ? JSON.parse(JSON.stringify(tpl.sampleAnswers)) : {};
}
