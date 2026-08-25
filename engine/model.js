/**
 * @module model
 * Variable metadata model: types, labels, options, validation, coercion,
 * computed variables, and empty-data scaffolding.
 *
 * Types: text, longtext, number, currency, date, boolean, selection, multiselect,
 * object, list, computed (has `formula`). Also accepted: email, phone.
 */

import { parseExpr, evalExpr, collectIdentifiers, createTrace } from './expr.js';
import { parseDate, toISODate } from './functions.js';
import { humanize, getPath } from './analyze.js';

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
  return model;
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
  const fresh = createModel(analysis);
  const out = { variables: {}, order: [] };
  const existingVars = (existing && existing.variables) || {};
  for (const path of fresh.order) {
    const f = fresh.variables[path];
    const e = existingVars[path];
    if (!e) { out.variables[path] = f; out.order.push(path); continue; }
    const userChangedType = e.type !== e.inferredType;
    const userChangedLabel = e.label !== humanize(path);
    out.variables[path] = {
      ...f,
      label: userChangedLabel ? e.label : f.label,
      type: userChangedType ? e.type : f.type,
      inferredType: f.inferredType,
      required: e.required,
      options: e.options && e.options.length ? e.options : f.options,
      help: e.help || '',
      formula: e.formula,
      orphaned: false,
      custom: e.custom,
    };
    out.order.push(path);
  }
  for (const path of Object.keys(existingVars)) {
    if (out.variables[path]) continue;
    const e = existingVars[path];
    // user-created computed variables are kept as-is; the rest are orphaned
    out.variables[path] = { ...e, orphaned: e.type !== 'computed' || e.orphaned === true ? true : false };
    if (e.type === 'computed') out.variables[path].orphaned = false;
    out.order.push(path);
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
      const n = Number(String(value).replace(/[$,\s]/g, ''));
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

/**
 * Validate data against the model.
 * @param {Model} model
 * @param {Object} data
 * @param {{relevant?: string[], requiredOnly?: boolean}} [options] restrict to relevant paths
 * @returns {Array<{path:string, message:string}>}
 */
export function validate(model, data, options = {}) {
  const errors = [];
  const paths = options.relevant || model.order;
  const check = (def, value, path) => {
    if (isBlank(value)) {
      if (def.required && !options.requiredOnly === false) errors.push({ path, message: `${def.label || path} is required` });
      else if (def.required) errors.push({ path, message: `${def.label || path} is required` });
      return;
    }
    switch (def.type) {
      case 'number': case 'currency':
        if (typeof value !== 'number' && Number.isNaN(Number(String(value).replace(/[$,\s]/g, '')))) errors.push({ path, message: `${def.label || path} must be a number` });
        break;
      case 'date':
        if (!parseDate(value)) errors.push({ path, message: `${def.label || path} must be a valid date` });
        break;
      case 'boolean':
        if (typeof value !== 'boolean') errors.push({ path, message: `${def.label || path} must be Yes or No` });
        break;
      case 'selection':
        if (def.options && def.options.length && !def.options.some((o) => String(o).toLowerCase() === String(value).toLowerCase())) errors.push({ path, message: `${def.label || path} must be one of: ${def.options.join(', ')}` });
        break;
      case 'multiselect':
        if (!Array.isArray(value)) errors.push({ path, message: `${def.label || path} must be a list` });
        else if (def.options && def.options.length) for (const v of value) if (!def.options.includes(v)) errors.push({ path, message: `${def.label || path}: "${v}" is not an option` });
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors.push({ path, message: `${def.label || path} must be an email address` });
        break;
      case 'list':
        if (!Array.isArray(value)) errors.push({ path, message: `${def.label || path} must be a list` });
        break;
      default: break;
    }
  };
  for (const path of paths) {
    const def = model.variables[path];
    if (!def || def.orphaned || def.type === 'computed' || def.type === 'object') continue;
    if (def.isListItemField && def.listPath) {
      const list = getPath(data, def.listPath);
      if (!Array.isArray(list)) continue;
      const sub = path.slice(def.listPath.length + 3); // strip "List[]."
      list.forEach((item, i) => check(def, getPath(item, sub), `${def.listPath}[${i}].${sub}`));
      continue;
    }
    check(def, getPath(data, path), path);
  }
  return errors;
}

/**
 * Set a dotted path on an object, creating intermediate objects.
 */
export function setPath(obj, path, value) {
  const segs = String(path).split('.');
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
 * Formulas are evaluated in dependency order; cycles produce an error entry.
 * @param {Model} model
 * @param {Object} data
 * @returns {{data:Object, errors:Array<{path:string,message:string}>}}
 */
export function computeDerived(model, data) {
  const out = structuredClone(data || {});
  const errors = [];
  const computed = model.order.filter((p) => model.variables[p] && model.variables[p].type === 'computed' && model.variables[p].formula && !model.variables[p].isListItemField);
  const asts = new Map();
  const deps = new Map();
  for (const p of computed) {
    try {
      const ast = parseExpr(model.variables[p].formula);
      asts.set(p, ast);
      deps.set(p, collectIdentifiers(ast).filter((d) => computed.includes(d)));
    } catch (e) {
      errors.push({ path: p, message: `Bad formula: ${e.message}` });
    }
  }
  const state = new Map(); // 0 = unvisited, 1 = visiting, 2 = done
  const visit = (p, chain) => {
    if (state.get(p) === 2) return;
    if (state.get(p) === 1) { errors.push({ path: p, message: `Circular formula: ${[...chain, p].join(' → ')}` }); return; }
    if (!asts.has(p)) return;
    state.set(p, 1);
    for (const d of deps.get(p)) visit(d, [...chain, p]);
    state.set(p, 2);
    try {
      const v = evalExpr(asts.get(p), out, createTrace());
      setPath(out, p, v);
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
