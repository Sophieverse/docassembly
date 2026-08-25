/**
 * @module model
 * Variable metadata model: types, labels, options, validation, coercion,
 * computed variables, and empty-data scaffolding.
 *
 * Types: text, longtext, number, currency, date, boolean, selection, multiselect,
 * object, list, computed (has `formula`). Also accepted: email, phone.
 */

import { parseExpr, evalExpr, collectIdentifiers, createTrace, createScope } from './expr.js';
import { parseDate, toISODate } from './functions.js';
import { humanize, getPath, isSafeKey } from './analyze.js';
import { itemVars } from './evaluate.js';

export { humanize };

export const TYPES = ['text', 'longtext', 'number', 'currency', 'date', 'boolean', 'selection', 'multiselect', 'object', 'list', 'computed', 'email', 'phone'];

/**
 * @typedef {Object} VarDef
 * @property {string} path
 * @property {string} name
 * @property {string|null} parent
 * @property {string} label
 * @property {string} type
 * @property {string} inferredType
 * @property {boolean} required
 * @property {string[]} [options]
 * @property {string} [help]
 * @property {string} [formula]    for computed
 * @property {string} [listPath]
 * @property {boolean} isListItemField
 * @property {boolean} orphaned    no longer referenced by the template
 * @property {Array} usedIn
 * @property {string[]} gatedBy
 * @property {number|string} [min]        numbers/currency: minimum; dates: earliest ISO date
 * @property {number|string} [max]
 * @property {number} [minLength]         text: minimum characters; lists/multiselect: minimum items
 * @property {number} [maxLength]
 * @property {string} [pattern]           regular expression source the text must match
 * @property {string} [validate]          expression; `value`/`this` = the value, whole data in scope (item fields see item fields)
 * @property {string} [message]           custom error text for any failing rule
 * @property {any} [default]
 * @property {Object<string, any>} [fromTemplate]  field → value that came from a template `@` annotation
 * @property {true|Object<string, boolean>} [custom]  fields the user edited in the UI (win over annotations)
 */

/**
 * @typedef {Object} Model
 * @property {Object<string, VarDef>} variables
 * @property {string[]} order  paths in template order
 */

function defFromInfo(info) {
  return {
    path: info.path,
    name: info.name,
    parent: info.parent,
    label: humanize(info.path),
    type: info.inferredType,
    inferredType: info.inferredType,
    required: !['object', 'list', 'boolean'].includes(info.inferredType),
    options: info.options ? [...info.options] : undefined,
    inferredOptions: info.options ? [...info.options] : undefined,
    help: '',
    formula: undefined,
    listPath: info.listPath || undefined,
    isListItemField: !!info.isListItemField,
    orphaned: false,
    usedIn: info.usedIn || [],
    gatedBy: info.gatedBy || [],
    filters: info.filters || [],
  };
}

/**
 * Create a model from analyze() output.
 * @param {{variables: Map<string, Object>}} analysis
 * @returns {Model}
 */
export function createModel(analysis) {
  const model = { variables: {}, order: [] };
  for (const [path, info] of analysis.variables) {
    model.variables[path] = defFromInfo(info);
    model.order.push(path);
  }
  applyAnnotations(model, analysis.annotations);
  return model;
}

/** Fields a template `@` annotation may set. */
export const ANNOTATABLE = ['label', 'help', 'options', 'default', 'required', 'type', 'formula', 'min', 'max', 'minLength', 'maxLength', 'pattern', 'validate', 'message'];

const defaultRequired = (type) => !['object', 'list', 'boolean', 'computed'].includes(type);

function segmentsOf(path) {
  const segs = String(path).split('.');
  const name = segs[segs.length - 1];
  let parent = segs.length > 1 ? segs.slice(0, -1).join('.') : null;
  let isListItemField = false, listPath = undefined;
  if (parent && parent.endsWith('[]')) { listPath = parent.slice(0, -2); parent = listPath; isListItemField = true; }
  else if (parent && parent.includes('[]')) { isListItemField = true; listPath = parent.slice(0, parent.lastIndexOf('[]')); }
  return { name, parent, isListItemField, listPath };
}

/**
 * Apply template annotations (from analyze().annotations) onto a model in place.
 * Every applied field is recorded in `def.fromTemplate[field]`. A `@formula` for a path the
 * template never prints creates a computed variable.
 * @param {Model} model
 * @param {Map<string, Object>} [annotations]
 */
export function applyAnnotations(model, annotations) {
  if (!annotations) return model;
  for (const [path, ann] of annotations) {
    let def = model.variables[path];
    if (!def) {
      if (!ann.formula && ann.type !== 'computed') continue; // annotation for a variable the template does not use
      const sg = segmentsOf(path);
      def = { path, name: sg.name, parent: sg.parent, label: humanize(path), type: 'computed', inferredType: 'computed', required: false, help: '', listPath: sg.listPath, isListItemField: sg.isListItemField, orphaned: false, usedIn: [], gatedBy: [], filters: [] };
      model.variables[path] = def;
      model.order.push(path);
    }
    def.fromTemplate = {};
    // type first so option/default handling can see it
    if (ann.type) { def.type = ann.type; def.fromTemplate.type = ann.type; }
    if (ann.options) { def.options = [...ann.options]; def.fromTemplate.options = [...ann.options]; if (!ann.type && !['selection', 'multiselect'].includes(def.type)) { def.type = 'selection'; def.fromTemplate.type = 'selection'; } }
    if (ann.formula !== undefined) { def.formula = ann.formula; def.fromTemplate.formula = ann.formula; if (def.type !== 'computed') { def.type = 'computed'; def.fromTemplate.type = 'computed'; } }
    if (ann.required !== undefined) { def.required = ann.required; def.fromTemplate.required = ann.required; }
    if (def.type === 'computed' && ann.required === undefined) def.required = false;
    for (const k of ['label', 'help', 'min', 'max', 'minLength', 'maxLength', 'pattern', 'validate', 'message']) {
      if (ann[k] !== undefined) { def[k] = ann[k]; def.fromTemplate[k] = ann[k]; }
    }
    if (ann.default !== undefined) {
      const raw = ann.default;
      const v = def.type === 'multiselect' ? raw.split(/\s*\|\s*/).filter(Boolean) : coerce(raw, def.type);
      def.default = v; def.fromTemplate.default = v;
    }
  }
  return model;
}

/** Baseline (non-user) value of a field, given a freshly inferred definition. */
function inferredBaseline(field, fresh, e) {
  switch (field) {
    case 'label': return humanize(fresh.path);
    case 'type': return e.inferredType;
    case 'required': return defaultRequired(e.inferredType);
    case 'help': return '';
    case 'options': return e.inferredOptions;
    default: return undefined;
  }
}

const same = (a, b) => JSON.stringify(a === '' ? undefined : a) === JSON.stringify(b === '' ? undefined : b);

/**
 * Was this field edited by the user in the UI? Explicit `custom` flags win; otherwise a value that
 * differs from both what inference produced and what the last template annotation set is a user edit.
 */
function isUserEdited(e, field, fresh) {
  if (e.custom === true) return true;
  if (e.custom && typeof e.custom === 'object' && e.custom[field]) return true;
  if (e.custom && typeof e.custom === 'object' && e.custom[field] === false) return false;
  const v = e[field];
  if (field === 'options') { if (e.fromTemplate && 'options' in e.fromTemplate && same(v, e.fromTemplate.options)) return false; return userChangedOptions(e, fresh); }
  if (e.fromTemplate && field in e.fromTemplate && same(v, e.fromTemplate[field])) return false;
  if (same(v, inferredBaseline(field, fresh, e))) return false;
  if (field === 'formula') return v !== undefined && v !== '';
  return !same(v, undefined);
}

/**
 * Did the user edit the options list, or is it just what analysis inferred last time?
 * (Template edits that add `X = "NY"` must show up as a new option.)
 */
function userChangedOptions(e, f) {
  if (!e.options || !e.options.length) return false;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
  if (e.inferredOptions) return !same(e.options, e.inferredOptions);
  // legacy model without inferredOptions: treat as inferred when every option is one analysis still finds
  const fresh = f.options || [];
  return !e.options.every((o) => fresh.includes(typeof o === 'object' ? o.value : o));
}

/**
 * Merge a fresh analysis into an existing model, preserving user edits
 * (label, type, options, help, required, formula) and marking variables that
 * no longer appear as `orphaned`.
 * @param {Model} existing
 * @param {{variables: Map<string, Object>}} analysis
 * @returns {Model}
 */
export function mergeModel(existing, analysis) {
  const fresh = createModel({ variables: analysis.variables }); // inference only; annotations applied below
  const annotations = analysis.annotations || new Map();
  const out = { variables: {}, order: [] };
  const existingVars = (existing && existing.variables) || {};
  for (const path of fresh.order) {
    const f = fresh.variables[path];
    const e = existingVars[path];
    if (!e) { out.variables[path] = f; out.order.push(path); continue; }
    // Spread the existing definition first so user-owned fields (default, custom…) survive.
    const merged = { ...e, ...f, inferredType: f.inferredType, inferredOptions: f.inferredOptions, orphaned: false, custom: e.custom };
    const userEdited = {};
    for (const field of ANNOTATABLE) {
      userEdited[field] = isUserEdited(e, field, f);
      if (userEdited[field]) merged[field] = e[field];
      else if (field === 'help') merged.help = '';
      else if (['label', 'type', 'required', 'options'].includes(field)) merged[field] = f[field];
      else merged[field] = undefined;
    }
    if (userEdited.type && e.type === 'computed' && !userEdited.formula) merged.formula = e.formula;
    delete merged.fromTemplate;
    out.variables[path] = merged;
    out.order.push(path);
  }
  for (const path of Object.keys(existingVars)) {
    if (out.variables[path]) continue;
    const e = existingVars[path];
    // user-created computed variables are kept as-is; the rest are orphaned
    out.variables[path] = { ...e, orphaned: e.type !== 'computed' };
    delete out.variables[path].fromTemplate;
    out.order.push(path);
  }
  // Annotations apply wherever the user has not edited the field in the UI.
  const filtered = new Map();
  for (const [path, ann] of annotations) {
    const e = existingVars[path];
    if (!e) { filtered.set(path, ann); continue; }
    const f = fresh.variables[path] || e;
    const keep = {};
    for (const [k, v] of Object.entries(ann)) {
      const field = k === 'minlength' ? 'minLength' : k === 'maxlength' ? 'maxLength' : k;
      if (!isUserEdited(e, field, f)) keep[k] = v;
    }
    if (Object.keys(keep).length) filtered.set(path, keep);
  }
  applyAnnotations(out, filtered);
  // A computed variable that came from a removed @formula annotation is orphaned, not kept.
  for (const path of out.order) {
    const d = out.variables[path];
    if (d.type === 'computed' && !analysis.variables.has(path) && existingVars[path] && existingVars[path].fromTemplate && 'formula' in existingVars[path].fromTemplate && !(d.fromTemplate && 'formula' in d.fromTemplate)) d.orphaned = true;
  }
  return out;
}

/**
 * Coerce a raw (usually string) value to the given type. Invalid input returns
 * the original value so validate() can flag it.
 * @param {any} value
 * @param {string} type
 */
export function coerce(value, type) {
  if (value === undefined || value === null) return value;
  switch (type) {
    case 'number':
    case 'currency': {
      if (typeof value === 'number') return value;
      if (value === '') return '';
      const cleaned = String(value).replace(/[$€£¥,\s]/g, '');
      const paren = /^\((.+)\)$/.exec(cleaned); // accountants' negative: (500)
      const n = Number(paren ? '-' + paren[1] : cleaned);
      return Number.isNaN(n) ? value : n;
    }
    case 'date': {
      if (value === '') return '';
      const d = parseDate(value);
      return d ? toISODate(d) : value;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === '') return '';
      const s = String(value).trim().toLowerCase();
      if (['true', 'yes', 'y', '1', 'on'].includes(s)) return true;
      if (['false', 'no', 'n', '0', 'off'].includes(s)) return false;
      return value;
    }
    case 'multiselect':
    case 'list': {
      if (Array.isArray(value)) return value;
      if (value === '') return [];
      if (type === 'multiselect' && typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
      return [value];
    }
    case 'object': return typeof value === 'object' ? value : value === '' ? {} : value;
    case 'text': case 'longtext': case 'selection': case 'email': case 'phone': return typeof value === 'string' ? value : String(value);
    default: return value;
  }
}

const isBlank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Reject path segments that would reach into Object.prototype (`__proto__`, `constructor`, `prototype`). */
export function assertSafeKey(key) {
  if (!isSafeKey(key)) throw new Error(`Invalid variable path segment "${key}"`);
}

/**
 * Walk every item of a (possibly nested) list path such as "Children" or "Trusts[].Beneficiaries".
 * Calls fn(item, index, count, concretePath, scope) where `scope` has the item fields (and _index…)
 * layered over the enclosing scopes and `concretePath` is e.g. "Trusts[0].Beneficiaries[2]".
 */
function forEachItem(data, listPath, fn, rootScope) {
  const root = rootScope || createScope(data || {});
  const rec = (obj, segsLeft, concrete, scope) => {
    const idx = segsLeft.indexOf('[]');
    if (idx === -1) {
      const list = getPath(obj, segsLeft);
      if (!Array.isArray(list)) return;
      const full = concrete ? concrete + '.' + segsLeft : segsLeft;
      list.forEach((item, i) => fn(item, i, list.length, `${full}[${i}]`, createScope(itemVars(item, i, list.length), scope, full + '[]')));
      return;
    }
    const head = segsLeft.slice(0, idx), tail = segsLeft.slice(idx + 3);
    const list = getPath(obj, head);
    if (!Array.isArray(list)) return;
    const full = concrete ? concrete + '.' + head : head;
    list.forEach((item, i) => rec(item, tail, `${full}[${i}]`, createScope(itemVars(item, i, list.length), scope, full + '[]')));
  };
  rec(data || {}, listPath, '', root);
}

const RULE_CACHE = new Map();
function compiledRule(src) {
  if (!RULE_CACHE.has(src)) { try { RULE_CACHE.set(src, parseExpr(src)); } catch (e) { RULE_CACHE.set(src, e); } }
  return RULE_CACHE.get(src);
}

const isDateish = (def, bound) => def.type === 'date' || (typeof bound === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bound));
const toNum = (v) => (typeof v === 'number' ? v : Number(String(v).replace(/[$€£¥,\s]/g, '')));

/**
 * Apply the declarative rules (min/max/minLength/maxLength/pattern/validate) of one definition to a
 * non-blank value. Returns error messages (already prefixed with the label; `def.message` replaces them).
 * @param {VarDef} def
 * @param {any} value
 * @param {import('./expr.js').Scope} scope enclosing scope (root data or list item)
 */
function ruleErrors(def, value, scope) {
  const label = def.label || def.path;
  const errs = [];
  const fail = (msg) => errs.push(def.message ? def.message : `${label} ${msg}`);
  if (def.min !== undefined && def.min !== null && def.min !== '') {
    if (isDateish(def, def.min)) { const d = parseDate(value), m = parseDate(def.min); if (d && m && d < m) fail(`must be on or after ${toISODate(m)}`); }
    else { const n = toNum(value), m = toNum(def.min); if (!Number.isNaN(n) && !Number.isNaN(m) && n < m) fail(`must be at least ${def.min}`); }
  }
  if (def.max !== undefined && def.max !== null && def.max !== '') {
    if (isDateish(def, def.max)) { const d = parseDate(value), m = parseDate(def.max); if (d && m && d > m) fail(`must be on or before ${toISODate(m)}`); }
    else { const n = toNum(value), m = toNum(def.max); if (!Number.isNaN(n) && !Number.isNaN(m) && n > m) fail(`must be at most ${def.max}`); }
  }
  const len = Array.isArray(value) ? value.length : String(value).length;
  const unit = Array.isArray(value) ? 'item' : 'character';
  if (def.minLength != null && def.minLength !== '' && len < Number(def.minLength)) fail(`must have at least ${def.minLength} ${unit}${Number(def.minLength) === 1 ? '' : 's'}`);
  if (def.maxLength != null && def.maxLength !== '' && len > Number(def.maxLength)) fail(`must have at most ${def.maxLength} ${unit}${Number(def.maxLength) === 1 ? '' : 's'}`);
  if (def.pattern) {
    let re = null;
    try { re = new RegExp(def.pattern); } catch { errs.push(`${label}: invalid pattern /${def.pattern}/`); }
    if (re && !re.test(String(value))) fail(`must match pattern ${def.pattern}`);
  }
  if (def.validate && String(def.validate).trim()) {
    const ast = compiledRule(String(def.validate).trim());
    if (ast instanceof Error) errs.push(`${label}: bad validation rule: ${ast.message}`);
    else {
      const sc = createScope({ value, this: value }, scope);
      try {
        const ok = evalExpr(ast, sc, createTrace());
        if (!ok || ok === '' || (Array.isArray(ok) && !ok.length)) fail(`is not valid (rule: ${def.validate})`);
      } catch (e) { errs.push(`${label}: validation rule error: ${e.message}`); }
    }
  }
  return errs;
}

/**
 * Validate data against the model: required answers, type/format, then the definition's rules
 * (`min`, `max`, `minLength`, `maxLength`, `pattern`, `validate`, with `message` overriding the text).
 *
 * `relevant` may hold generic paths ("Members[].Percent" → every item) and/or concrete item paths
 * ("Members[1].Percent" → only that item). Without it every variable and item is checked.
 * @param {Model} model
 * @param {Object} data
 * @param {{relevant?: string[], requiredOnly?: boolean}} [options] relevant: restrict to these paths; requiredOnly: skip type/format/rule checks
 * @returns {Array<{path:string, message:string}>}
 */
export function validate(model, data, options = {}) {
  const errors = [];
  const relevant = options.relevant ? new Set(options.relevant) : null;
  const genericOf = (p) => p.replace(/\[\d+\]/g, '[]');
  const concreteByGeneric = new Map();
  if (relevant) for (const p of relevant) { const g = genericOf(p); if (g !== p) { if (!concreteByGeneric.has(g)) concreteByGeneric.set(g, new Set()); concreteByGeneric.get(g).add(p); } }
  const paths = relevant ? model.order.filter((p) => relevant.has(p) || concreteByGeneric.has(p)) : model.order;
  const rootScope = createScope(data || {});
  const check = (def, value, path, scope) => {
    const label = def.label || path;
    if (isBlank(value)) {
      if (def.required) errors.push({ path, message: `${label} is required` });
      return;
    }
    if (options.requiredOnly) return; // only report missing required answers, not format problems
    const before = errors.length;
    switch (def.type) {
      case 'number': case 'currency':
        if (typeof value !== 'number' && Number.isNaN(Number(String(value).replace(/[$,\s]/g, '')))) errors.push({ path, message: `${label} must be a number` });
        break;
      case 'date':
        if (!parseDate(value)) errors.push({ path, message: `${label} must be a valid date` });
        break;
      case 'boolean':
        if (typeof value !== 'boolean') errors.push({ path, message: `${label} must be Yes or No` });
        break;
      case 'selection':
        if (def.options && def.options.length && !def.options.some((o) => String(typeof o === 'object' ? o.value : o).toLowerCase() === String(value).toLowerCase())) errors.push({ path, message: `${label} must be one of: ${def.options.map((o) => (typeof o === 'object' ? o.value : o)).join(', ')}` });
        break;
      case 'multiselect':
        if (!Array.isArray(value)) errors.push({ path, message: `${label} must be a list` });
        else if (def.options && def.options.length) for (const v of value) if (!def.options.includes(v)) errors.push({ path, message: `${label}: "${v}" is not an option` });
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors.push({ path, message: `${label} must be an email address` });
        break;
      case 'list':
        if (!Array.isArray(value)) errors.push({ path, message: `${label} must be a list` });
        break;
      default: break;
    }
    if (errors.length > before) return; // a malformed value: don't pile rule errors on top
    for (const message of ruleErrors(def, value, scope)) errors.push({ path, message });
  };
  for (const path of paths) {
    const def = model.variables[path];
    if (!def || def.orphaned || def.type === 'computed' || def.type === 'object') continue;
    if (def.isListItemField && def.listPath) {
      const sub = path.slice(path.lastIndexOf('[].') + 3); // strip "…List[]."
      const only = relevant && !relevant.has(path) ? concreteByGeneric.get(path) : null;
      forEachItem(data, def.listPath, (item, i, n, concrete, scope) => {
        const itemPath = `${concrete}.${sub}`;
        if (only && !only.has(itemPath)) return;
        check(def, getPath(item, sub), itemPath, scope);
      }, rootScope);
      continue;
    }
    check(def, getPath(data, path), path, rootScope);
  }
  return errors;
}

/**
 * Set a dotted path on an object, creating intermediate objects.
 */
export function setPath(obj, path, value) {
  const segs = String(path).split('.');
  for (const seg of segs) assertSafeKey(seg.replace(/\[\d+\]$/, ''));
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const m = /^(.+?)\[(\d+)\]$/.exec(segs[i]);
    const key = m ? m[1] : segs[i];
    if (m) {
      if (!Array.isArray(cur[key])) cur[key] = [];
      if (!cur[key][+m[2]] || typeof cur[key][+m[2]] !== 'object') cur[key][+m[2]] = {};
      cur = cur[key][+m[2]];
    } else {
      if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {};
      cur = cur[key];
    }
  }
  cur[segs[segs.length - 1]] = value;
  return obj;
}

/**
 * Evaluate computed variables (those with a `formula`) into a copy of data.
 *
 * Top-level computed variables ("Total": `Fee + Tax`) are set on the data; per-item computed
 * variables ("Children[].IsMinor": `yearsBetween(DOB, today()) < 18`) are evaluated once per list
 * item with the item's fields in scope (shadowing outer data; `_index`, `_first`… available) and
 * stored on each item. Formulas run in dependency order across both kinds, so
 * `count(Children|filter: IsMinor)` sees the per-item results. A cycle produces an error entry.
 * @param {Model} model
 * @param {Object} data
 * @returns {{data:Object, errors:Array<{path:string,message:string}>}}
 */
export function computeDerived(model, data) {
  const out = structuredClone(data || {});
  const errors = [];
  const vars = model.variables || {};
  const computed = (model.order || []).filter((p) => vars[p] && vars[p].type === 'computed' && vars[p].formula && !vars[p].orphaned);
  const listOf = (p) => { const d = vars[p]; return d.isListItemField ? (d.listPath || p.slice(0, p.lastIndexOf('[]'))) : null; };
  const asts = new Map();
  const deps = new Map();
  for (const p of computed) {
    try {
      const ast = parseExpr(vars[p].formula);
      asts.set(p, ast);
      const ids = collectIdentifiers(ast);
      const L = listOf(p);
      const d = new Set();
      for (const id of ids) {
        for (const q of computed) {
          if (q === p) continue;
          if (q === id || q.startsWith(id + '[]') || q.startsWith(id + '.')) d.add(q);
          else if (L && (q === `${L}[].${id}` || q.startsWith(`${L}[].${id}.`) || q.startsWith(`${L}[].${id}[]`))) d.add(q);
        }
      }
      deps.set(p, [...d]);
    } catch (e) {
      errors.push({ path: p, message: `Bad formula: ${e.message}` });
    }
  }
  const rootScope = createScope(out);
  const state = new Map(); // 0 = unvisited, 1 = visiting, 2 = done
  const visit = (p, chain) => {
    if (state.get(p) === 2) return;
    if (state.get(p) === 1) { errors.push({ path: p, message: `Circular formula: ${[...chain, p].join(' → ')}` }); return; }
    if (!asts.has(p)) return;
    state.set(p, 1);
    for (const d of deps.get(p)) visit(d, [...chain, p]);
    state.set(p, 2);
    const L = listOf(p);
    if (L) {
      const sub = p.slice(p.lastIndexOf('[].') + 3);
      forEachItem(out, L, (item, i, n, concrete, scope) => {
        try { setPath(out, `${concrete}.${sub}`, evalExpr(asts.get(p), scope, createTrace())); }
        catch (e) { errors.push({ path: `${concrete}.${sub}`, message: `Formula error: ${e.message}` }); }
      }, rootScope);
      return;
    }
    try {
      setPath(out, p, evalExpr(asts.get(p), rootScope, createTrace()));
    } catch (e) {
      errors.push({ path: p, message: `Formula error: ${e.message}` });
    }
  };
  for (const p of computed) visit(p, []);
  return { data: out, errors };
}

/**
 * Build an empty answer object shaped by the model: objects → {}, lists → [], leaves absent.
 * @param {Model} model
 * @returns {Object}
 */
export function emptyData(model) {
  const out = {};
  for (const p of model.order) {
    const def = model.variables[p];
    if (!def || def.orphaned || def.isListItemField) continue;
    if (def.type === 'object') setPath(out, p, {});
    else if (def.type === 'list') setPath(out, p, []);
    else if (def.type === 'multiselect') setPath(out, p, []);
  }
  return out;
}

/**
 * Create an empty item for a list, with nested objects/lists scaffolded.
 * @param {Model} model
 * @param {string} listPath
 */
export function emptyItem(model, listPath) {
  const out = {};
  const prefix = listPath + '[].';
  for (const p of model.order) {
    const def = model.variables[p];
    if (!def || !p.startsWith(prefix)) continue;
    const sub = p.slice(prefix.length);
    if (sub.includes('[]')) continue;
    if (def.type === 'object') setPath(out, sub, {});
    else if (def.type === 'list' || def.type === 'multiselect') setPath(out, sub, []);
  }
  return out;
}
