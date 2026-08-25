/**
 * @module ui-interview
 * #/interview/:templateId and #/interview/pkg/:packageId (?record=ID) — the auto-generated questionnaire.
 */
import * as store from './store.js';
import { el, clear, toast, prompt, modal, debounce } from './components.js';
import { navigate } from './router.js';
import { questionnaire, validate } from './engine-api.js';
import { compileCached, renderTemplate, withDerived, getPath, isAnswered } from './docgen.js';
import { renderQuestion, progress, itemFieldName, groupQuestions, genericPath, ownerOf, fillListFields, patchGroup } from './ui-fields.js';

/** Resolve what to interview: [{template, includeIf}] */
export function resolveTargets(params) {
  if (params.packageId) {
    const pkg = store.packages.get(params.packageId);
    if (!pkg) return { error: 'Package not found', targets: [] };
    const targets = (pkg.items || []).map((it) => ({ template: store.templates.get(it.templateId), includeIf: it.includeIf || '' })).filter((t) => t.template);
    return { pkg, targets, name: pkg.name };
  }
  const t = store.templates.get(params.templateId);
  if (!t) return { error: 'Template not found', targets: [] };
  return { targets: [{ template: t, includeIf: '' }], name: t.name, template: t };
}

/** Evaluate an include-if expression by rendering a one-line template. */
export function includeIfHolds(expr, data) {
  if (!expr || !expr.trim()) return true;
  try {
    const r = renderTemplate({ text: `{[if ${expr}]}1{[end if]}`, model: null }, data);
    if (r.errors.length) return true;
    return r.text.trim() === '1';
  } catch (e) { return true; }
}

/** Merge questions from several templates by path, preserving first-seen order. */
export function collectQuestions(targets, data) {
  const seen = new Map();
  const out = [];
  for (const { template, includeIf } of targets) {
    if (!includeIfHolds(includeIf, data) && targets.length > 1) continue;
    const c = compileCached(template.text || '');
    if (c.errors && c.errors.length) continue;
    let qs = [];
    try { qs = questionnaire(c.ast, withDerived(template, data), template.model) || []; } catch (e) { console.warn('questionnaire failed', e); }
    for (const q of qs) {
      if (seen.has(q.path)) {
        const prev = seen.get(q.path);
        if (!prev.options && q.options) prev.options = q.options;
        if (!prev.help && q.help) prev.help = q.help;
        continue;
      }
      const copy = { ...q };
      seen.set(q.path, copy);
      out.push(copy);
    }
  }
  const grouped = groupQuestions(out);
  for (const { template } of targets) fillListFields(grouped, template.model);
  return grouped;
}

export function renderInterview(main, ctx) {
  clear(main);
  const { targets, name, error, pkg, template } = resolveTargets(ctx.params);
  if (error || !targets.length) { main.appendChild(el('div.card', error || 'This package has no templates.', ' ', el('a', { href: '#/templates' }, 'Back'))); return; }

  let recordId = ctx.query.record || null;
  let record = recordId ? store.records.get(recordId) : null;
  if (recordId && !record) { toast('Record not found; starting blank'); recordId = null; }
  let data = record ? JSON.parse(JSON.stringify(record.data || {})) : {};
  // Apply model defaults for unanswered variables
  for (const { template: t } of targets) {
    for (const [path, v] of Object.entries((t.model && t.model.variables) || {})) {
      if (v && v.default !== undefined && getPath(data, path) === undefined) setDefault(data, path, v.default);
    }
  }
  let dirty = false;
  let questions = [];
  const elems = new Map(); // path → element
  const sig = new Map();   // path → itemFields signature
  let errors = new Map();

  const hashBase = pkg ? `/interview/pkg/${pkg.id}` : `/interview/${template.id}`;
  const outputBase = pkg ? `/output/pkg/${pkg.id}` : `/output/${template.id}`;

  /* ---------- header + record bar ---------- */
  const recordLabel = el('strong', record ? record.name : 'Unsaved answers');
  main.appendChild(el('div.page-head',
    el('a.btn.btn-ghost.btn-sm', { href: template ? `#/templates/${template.id}` : `#/packages/${pkg.id}` }, '← Back'),
    el('h1', name), pkg ? el('span.badge', 'package') : null,
    el('div.actions',
      template && template.sampleAnswers && !record ? el('button.btn', { type: 'button', onClick: () => { data = JSON.parse(JSON.stringify(template.sampleAnswers)); for (const n of elems.values()) n.remove(); elems.clear(); sig.clear(); dirty = true; refresh(); toast('Sample answers loaded'); } }, 'Use sample answers') : null,
      el('button.btn', { type: 'button', onClick: loadFromRecord }, 'Load from record…'),
      el('button.btn', { type: 'button', onClick: () => saveToRecord() }, 'Save to record'),
    )));
  main.appendChild(el('div.record-bar', el('span.label', 'Record:'), recordLabel,
    el('span.muted.small', record ? '— changes are kept in this record when you save or generate.' : '— answers are saved into a new record when you click Generate.')));

  /* ---------- layout ---------- */
  const progressText = el('span.small.muted');
  const progressFill = el('span');
  const form = el('form.interview-form', { novalidate: true, onSubmit: (e) => { e.preventDefault(); generate(); } });
  const qHost = el('div');
  const errSummary = el('div.errors.hidden');
  form.append(el('div.progress', el('div.progress-bar', progressFill), progressText), errSummary, qHost,
    el('div.sticky-actions',
      el('button.btn.btn-primary', { type: 'submit' }, 'Generate document' + (targets.length > 1 ? 's' : '') + ' →'),
      el('button.btn', { type: 'button', onClick: () => saveToRecord() }, 'Save answers'),
      el('span.grow'), el('span.muted.small', 'Questions appear as they become relevant.')));
  const preview = el('div.interview-side');
  main.appendChild(el('div.interview-layout', form, preview));

  /* ---------- questionnaire rendering (diffed so typing is never interrupted) ---------- */
  function fieldSig(q) { return JSON.stringify((q.itemFields || []).map((f) => [itemFieldName(f, q.path), f.type, f.options])); }
  function refresh() {
    questions = collectQuestions(targets, data);
    const wanted = new Set(questions.map((q) => q.path));
    // removals
    for (const [path, node] of elems) {
      if (!wanted.has(path)) {
        elems.delete(path); sig.delete(path);
        node.classList.add('leaving');
        setTimeout(() => node.remove(), 200);
        node.dataset.leaving = '1';
      }
    }
    // groups whose item fields changed relevance: patch objects in place; lists are re-rendered
    // (unless the user is typing inside one — then it is retried on focusout).
    for (const q of questions) {
      if ((q.type === 'object' || q.type === 'list') && elems.has(q.path) && sig.get(q.path) !== fieldSig(q)) {
        const old = elems.get(q.path);
        if (q.type === 'object' && patchGroup(old, q, data, onAnswer, { errors })) { sig.set(q.path, fieldSig(q)); continue; }
        const focusedInside = old.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON';
        if (!focusedInside) { const n = make(q); old.replaceWith(n); elems.set(q.path, n); sig.set(q.path, fieldSig(q)); }
        else pendingGroups.add(q.path);
      }
    }
    // insertions / ordering
    let cursor = qHost.firstElementChild;
    for (const q of questions) {
      while (cursor && cursor.dataset.leaving) cursor = cursor.nextElementSibling;
      let node = elems.get(q.path);
      if (!node) { node = make(q); elems.set(q.path, node); sig.set(q.path, fieldSig(q)); qHost.insertBefore(node, cursor); continue; }
      if (node !== cursor) qHost.insertBefore(node, cursor); else cursor = cursor.nextElementSibling;
    }
    const p = progress(questions, data);
    progressText.textContent = `${p.done} of ${p.total} answered`;
    progressFill.style.width = (p.total ? Math.round((p.done / p.total) * 100) : 0) + '%';
    updatePreview();
  }
  function make(q) {
    const node = renderQuestion(q, data, onAnswer, { errors });
    return node;
  }
  function onAnswer() {
    dirty = true;
    if (errors.size) { errors = new Map(); errSummary.classList.add('hidden'); qHost.querySelectorAll('.invalid').forEach((n) => { n.classList.remove('invalid'); const e = n.querySelector(':scope > .error'); if (e) e.remove(); }); }
    scheduleRefresh();
  }
  const scheduleRefresh = debounce(refresh, 120);
  const pendingGroups = new Set();
  qHost.addEventListener('focusout', () => { if (pendingGroups.size) { pendingGroups.clear(); setTimeout(refresh, 50); } });

  /* ---------- live preview ---------- */
  const updatePreview = debounce(() => {
    clear(preview);
    for (const { template: t, includeIf } of targets) {
      const included = includeIfHolds(includeIf, data);
      if (targets.length > 1) preview.appendChild(el('div.flex.mb', el('strong', t.name), included ? null : el('span.badge.badge-warn', 'not included')));
      if (!included) continue;
      const r = renderTemplate(t, data);
      if (r.errors.length) { preview.appendChild(el('div.errors', 'Template has syntax errors: ', r.errors[0].message)); continue; }
      preview.appendChild(el('div.doc-host', { html: r.html || '<div class="doc"><p>(empty)</p></div>' }));
      preview.appendChild(el('div.mb'));
    }
  }, 250);

  /* ---------- records ---------- */
  function loadFromRecord() {
    const recs = store.records.list();
    if (!recs.length) { toast('No saved records yet'); return; }
    const list = el('div.picker-list', recs.map((r) => el('button', { type: 'button', onClick: () => { m.close(); useRecord(r); } }, el('span', r.name), el('span.muted.small', new Date(r.updatedAt).toLocaleDateString()))));
    const m = modal({ title: 'Load answers from a record', body: list });
  }
  function useRecord(r) {
    record = r; recordId = r.id;
    data = JSON.parse(JSON.stringify(r.data || {}));
    recordLabel.textContent = r.name;
    for (const n of elems.values()) n.remove();
    elems.clear(); sig.clear();
    history.replaceState(null, '', `#${hashBase}?record=${r.id}`);
    refresh();
    toast(`Loaded "${r.name}"`, 'ok');
  }
  async function saveToRecord(quiet = false) {
    if (!record) {
      const suggested = `${name} — ${new Date().toLocaleDateString()}`;
      const n = await prompt('Name this record (client or matter)', { title: 'Save to record', value: suggested });
      if (n == null) return false;
      record = store.newRecord({ name: n.trim() || suggested, data: JSON.parse(JSON.stringify(data)) });
      recordId = record.id;
      recordLabel.textContent = record.name;
      history.replaceState(null, '', `#${hashBase}?record=${record.id}`);
    } else {
      store.records.update(record.id, { data: JSON.parse(JSON.stringify(data)) });
    }
    dirty = false;
    if (!quiet) toast('Answers saved', 'ok');
    return true;
  }

  /* ---------- validation + generate ---------- */
  function collectErrors() {
    errors = new Map();
    const walk = (qs, scope, prefix) => {
      for (const q of qs) {
        const full = prefix ? prefix + '.' + q.path : q.path;
        if (q.type === 'object') { walk((q.itemFields || []).map((f) => ({ ...f, path: itemFieldName(f, q.path) })), getPath(scope, q.path) || {}, full); continue; }
        if (q.required && !isAnswered(getPath(scope, q.path))) errors.set(full, 'This answer is required.');
      }
    };
    walk(questions, data, '');
    for (const { template: t } of targets) {
      try {
        for (const e of validate(t.model, withDerived(t, data)) || []) {
          // Only report validation problems for variables currently asked.
          if (ownerOf(e.path, questions) && !errors.has(genericPath(e.path))) errors.set(genericPath(e.path), e.message);
        }
      } catch (e) { /* ignore */ }
    }
    return errors;
  }
  async function generate() {
    collectErrors();
    if (errors.size) {
      clear(errSummary); errSummary.classList.remove('hidden');
      errSummary.appendChild(el('div', `${errors.size} answer${errors.size === 1 ? ' needs' : 's need'} attention before generating:`));
      for (const [path, msg] of errors) {
        const q = ownerOf(path, questions);
        errSummary.appendChild(el('div', { onClick: () => { const n = elems.get(q ? q.path : path); if (n) { n.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = n.querySelector('input,select,textarea,button'); if (i) i.focus(); } } }, `• ${q ? q.label : path}: ${msg}`));
      }
      // re-render affected nodes with error state
      for (const [path] of errors) {
        const top = ownerOf(path, questions);
        if (!top) continue;
        const old = elems.get(top.path); if (!old) continue;
        const n = make(top); old.replaceWith(n); elems.set(top.path, n);
      }
      errSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!(await saveToRecord(true))) return;
    navigate(`${outputBase}?record=${record.id}`);
  }

  window.onbeforeunload = () => (dirty ? true : undefined);
  refresh();
  const first = qHost.querySelector('input,select,textarea,button');
  if (first) first.focus();
}

function setDefault(data, path, value) {
  const segs = path.split('.');
  let cur = data;
  for (let i = 0; i < segs.length - 1; i++) { if (typeof cur[segs[i]] !== 'object' || cur[segs[i]] == null) cur[segs[i]] = {}; cur = cur[segs[i]]; }
  cur[segs[segs.length - 1]] = value;
}
