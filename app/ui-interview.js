/**
 * @module ui-interview
 * #/interview/:templateId and #/interview/pkg/:packageId (?record=ID) — the auto-generated questionnaire.
 */
import * as store from './store.js';
import { el, clear, toast, prompt, modal, debounce, confirm } from './components.js';
import { navigate } from './router.js';
import { questionnaire, validate, relevantVariables, getConcretePath } from './engine-api.js';
import { compileCached, renderTemplate, withDerived, getPath, setPath, isAnswered, pruneEmpty } from './docgen.js';
import { renderQuestion, progress, itemFieldName, groupQuestions, genericPath, ownerOf, fillListFields, patchGroup, applyFieldErrors } from './ui-fields.js';

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
    if (r.errors.length) { console.warn('includeIf expression has a syntax error and is treated as true:', expr, r.errors[0].message); return true; }
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
  // Apply model defaults for unanswered variables (item-field defaults like "Children[].State" are applied when an item is added)
  const modelVars = {};
  for (const { template: t } of targets) {
    for (const [path, v] of Object.entries((t.model && t.model.variables) || {})) {
      modelVars[path] = v;
      if (!v || v.default === undefined || path.includes('[]')) continue;
      if (getPath(data, path) === undefined) setPath(data, path, JSON.parse(JSON.stringify(v.default)));
    }
  }
  // Firm defaults from Settings, when a template asks for them and the record has no value.
  { const s = store.getSettings();
    if (modelVars.FirmName && s.firmName && getPath(data, 'FirmName') === undefined) setPath(data, 'FirmName', s.firmName);
    if (modelVars.AttorneyName && s.attorneyName && getPath(data, 'AttorneyName') === undefined) setPath(data, 'AttorneyName', s.attorneyName); }
  let dirty = false;
  let questions = [];
  const elems = new Map(); // path → element
  const sig = new Map();   // path → itemFields signature
  let errors = new Map();   // concrete path ("Members[1].Percent") → message
  let generateTried = false; // after a blocked Generate, live validation also reports missing required answers

  const hashBase = pkg ? `/interview/pkg/${pkg.id}` : `/interview/${template.id}`;
  const outputBase = pkg ? `/output/pkg/${pkg.id}` : `/output/${template.id}`;

  /* ---------- header + record bar ---------- */
  const recordLabel = el('strong', record ? record.name : 'Unsaved answers');
  main.appendChild(el('div.page-head',
    el('a.btn.btn-ghost.btn-sm', { href: template ? `#/templates/${template.id}` : `#/packages/${pkg.id}` }, '← Back'),
    el('h1', name), pkg ? el('span.badge', 'package') : null,
    el('div.actions',
      template && template.sampleAnswers && !record ? el('button.btn', { type: 'button', onClick: async () => { if (!(await okToReplace())) return; data = JSON.parse(JSON.stringify(template.sampleAnswers)); for (const n of elems.values()) n.remove(); elems.clear(); sig.clear(); dirty = true; refresh(); toast('Sample answers loaded'); } }, 'Use sample answers') : null,
      el('button.btn', { type: 'button', onClick: loadFromRecord }, 'Load from record…'),
      el('button.btn', { type: 'button', onClick: () => saveToRecord() }, 'Save to record'),
    )));
  main.appendChild(el('div.record-bar', el('span.label', 'Record:'), recordLabel,
    el('span.muted.small', record ? '— changes are kept in this record when you save or generate.' : '— answers are saved into a new record when you click Generate.')));

  /* ---------- layout ---------- */
  const progressText = el('span.small.muted');
  const progressFill = el('span');
  const form = el('form.interview-form', { novalidate: true, onSubmit: (e) => { e.preventDefault(); generate(); } });
  // Enter in a text box moves to the next question instead of generating the document.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON' || e.target.type === 'submit') return;
    if (!/^(INPUT|SELECT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    const f = [...form.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), .segmented button')];
    const next = f[f.indexOf(e.target) + 1];
    if (next) next.focus();
  });
  const qHost = el('div');
  const errSummary = el('div.errors.hidden', { role: 'alert', tabindex: '-1' });
  const progressBar = el('div.progress-bar', { role: 'progressbar', 'aria-label': 'Questions answered', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, progressFill);
  form.append(el('div.progress', progressBar, progressText), errSummary, qHost,
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
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    progressFill.style.width = pct + '%';
    progressBar.setAttribute('aria-valuenow', String(pct));
    progressBar.setAttribute('aria-valuetext', `${p.done} of ${p.total} answered`);
    applyFieldErrors(qHost, errors);
    updatePreview();
  }
  function make(q) {
    const node = renderQuestion(q, data, onAnswer, { errors });
    return node;
  }
  function onAnswer() {
    dirty = true;
    scheduleRefresh();
    scheduleValidate();
  }
  const scheduleRefresh = debounce(refresh, 120);
  // Live validation: rules (min/max/pattern/validate…) as the user types; missing required answers only once Generate was tried.
  const scheduleValidate = debounce(() => {
    collectErrors({ requiredToo: generateTried });
    applyFieldErrors(qHost, errors);
    if (!errors.size) errSummary.classList.add('hidden');
    else if (!errSummary.classList.contains('hidden')) drawSummary();
  }, 350);
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
  async function okToReplace() {
    if (!dirty) return true;
    return confirm('Replace the answers you have entered here? Unsaved changes will be lost.', { okLabel: 'Replace', danger: true });
  }
  async function loadFromRecord() {
    if (!(await okToReplace())) return;
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
      record = store.newRecord({ name: n.trim() || suggested, data: pruneEmpty(data) });
      recordId = record.id;
      recordLabel.textContent = record.name;
      history.replaceState(null, '', `#${hashBase}?record=${record.id}`);
    } else {
      store.records.update(record.id, { data: pruneEmpty(data) });
    }
    dirty = false;
    if (!quiet) toast('Answers saved', 'ok');
    return true;
  }

  /* ---------- validation + generate ---------- */
  /** Concrete item paths on screen ("Members[0]", "Members[1]") are covered by the generic ones relevantVariables() yields. */
  function relevantFor(t, full) {
    try {
      const c = compileCached(t.text || '');
      if (!c.ast) return null;
      return relevantVariables(c.ast, full).relevant;
    } catch (e) { return null; }
  }
  /**
   * errors ← Map<concrete path, message>. Required answers are reported by the UI walk (top-level
   * and object fields) and by the engine (list items); only questions currently asked count.
   * opts.requiredToo=false skips "is required" so live validation does not nag while typing.
   */
  function collectErrors({ requiredToo = true } = {}) {
    errors = new Map();
    if (requiredToo) {
      const walk = (qs, scope, prefix) => {
        for (const q of qs) {
          const full = prefix ? prefix + '.' + q.path : q.path;
          if (q.type === 'object') { walk((q.itemFields || []).map((f) => ({ ...f, path: itemFieldName(f, q.path) })), getPath(scope, q.path) || {}, full); continue; }
          if (q.required && !isAnswered(getPath(scope, q.path))) errors.set(full, 'This answer is required.');
        }
      };
      walk(questions, data, '');
    }
    for (const { template: t, includeIf } of targets) {
      if (targets.length > 1 && !includeIfHolds(includeIf, data)) continue;
      if (!t.model) continue;
      try {
        const full = withDerived(t, data);
        const relevant = relevantFor(t, full);
        for (const e of validate(t.model, full, relevant ? { relevant } : {}) || []) {
          if (!e || !e.path) continue;
          // Only report validation problems for variables currently asked.
          if (!ownerOf(e.path, questions)) continue;
          if (errors.has(e.path)) continue;
          if (!requiredToo && !isAnswered(getConcretePath(full, e.path))) continue; // a blank answer: required-only, skipped while typing
          errors.set(e.path, e.message);
        }
      } catch (e) { console.warn('validate failed', e); }
    }
    return errors;
  }
  /** Focus the control for a concrete error path (falls back to the owning question). */
  function focusError(path) {
    const q = ownerOf(path, questions);
    const n = qHost.querySelector(`.q[data-full="${CSS.escape(path)}"]`) || elems.get(q ? q.path : path);
    if (!n) return;
    n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const i = n.querySelector('input:not([disabled]), select, textarea, .segmented button');
    if (i) i.focus();
  }
  function drawSummary() {
    clear(errSummary); errSummary.classList.remove('hidden');
    errSummary.appendChild(el('div', `${errors.size} answer${errors.size === 1 ? ' needs' : 's need'} attention before generating:`));
    for (const [path, msg] of errors) {
      const q = ownerOf(path, questions);
      errSummary.appendChild(el('a', { href: '#', onClick: (e) => { e.preventDefault(); focusError(path); } }, `• ${labelOf(path, q)}: ${msg}`));
    }
  }
  async function generate() {
    generateTried = true;
    scheduleValidate.cancel();
    collectErrors({ requiredToo: true });
    if (errors.size) {
      drawSummary();
      applyFieldErrors(qHost, errors);
      errSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
      errSummary.focus();
      return;
    }
    errSummary.classList.add('hidden');
    if (!(await saveToRecord(true))) return;
    navigate(`${outputBase}?record=${record.id}`);
  }

  /** Human label for a (possibly nested) error path: "Executor — Full name". */
  function labelOf(path, q) {
    if (!q) return path;
    const g = genericPath(path);
    if (q.path === g) return q.label || q.path;
    const rel = g.startsWith(q.path + '[].') ? g.slice(q.path.length + 3) : g.startsWith(q.path + '.') ? g.slice(q.path.length + 1) : g;
    const f = (q.itemFields || []).find((x) => itemFieldName(x, q.path) === rel);
    const idx = /\[(\d+)\]/.exec(String(path).slice(q.path.length));
    const item = idx ? ` ${Number(idx[1]) + 1}` : '';
    return `${q.label || q.path}${item} — ${f ? f.label || rel : rel}`;
  }

  window.onbeforeunload = () => (dirty ? true : undefined);
  refresh();
  const first = qHost.querySelector('input,select,textarea,button');
  if (first) first.focus();
}
