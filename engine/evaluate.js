/**
 * @module evaluate
 * Renders a template AST with data into plain text, tracking referenced /
 * missing / relevant variables and producing warnings.
 */

import { evalExpr, createScope, createTrace, truthy, pathOf, listIdentity, stripPuncFilter } from './expr.js';
import { functions as builtins, formatDate, isDateLike, toText, puncFor } from './functions.js';
export { listIdentity };
import { TemplateError } from './lexer.js';

/**
 * @typedef {Object} RenderOptions
 * @property {Object} [functions]   extra functions merged over the built-ins
 * @property {string} [dateFormat]  default date format (default "long")
 * @property {string} [yes]         boolean true text (default "Yes")
 * @property {string} [no]          boolean false text (default "No")
 * @property {string} [missingText] text substituted for missing values (default "")
 * @property {boolean} [strict]     throw on unknown functions / bad expressions instead of warning
 * @property {boolean} [autoDates]  reformat ISO-looking text ("2026-03-05") as a date (default true)
 * @property {Object}  [model]      model from model.js; when given, only variables typed `date` are auto-formatted
 */

/**
 * Convert a value to output text.
 * @param {any} v
 * @param {RenderOptions} opts
 */
export function formatValue(v, opts = {}) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? (opts.yes ?? 'Yes') : (opts.no ?? 'No');
  if (v instanceof Date) return formatDate(v, opts.dateFormat || 'long');
  if (typeof v === 'number') return Number.isNaN(v) ? '' : String(v);
  if (typeof v === 'string') {
    if (opts.autoDates === false || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(v.trim())) return v;
    const f = formatDate(v, opts.dateFormat || 'long');
    return f === '' ? v : f; // unparseable ("2026-13-45") → print as typed rather than vanish
  }
  if (Array.isArray(v)) return v.map((x) => formatValue(x, opts)).filter((s) => s !== '').join(', ');
  if (typeof v === 'object') {
    const label = v.FullName ?? v.fullName ?? v.Name ?? v.name ?? v.Title ?? v.title;
    return label != null ? formatValue(label, opts) : JSON.stringify(v);
  }
  return toText(v);
}

/**
 * Build the item variables for one list iteration.
 * @param {any} item
 * @param {number} i 0-based index
 * @param {number} n item count
 * @param {string} [itemName]
 * @param {Object} [punc] parsed punc spec (from `|punc:"1, 2, and 3"`)
 */
export function itemVars(item, i, n, itemName, punc) {
  const base = item != null && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date) ? { ...item } : {};
  base._item = item;
  base._index = i + 1;
  base._index0 = i;
  base._first = i === 0;
  base._last = i === n - 1;
  base._count = n;
  base._punc = punc ? puncFor(punc, i, n) : i === n - 1 ? '' : n === 2 ? ' and ' : i === n - 2 ? ', and ' : ', ';
  if (itemName) base[itemName] = item;
  return base;
}

/** `{[X|blank]}` / `{[blank(X)]}`: printing nothing is the point, so a missing X is not a warning. */
function endsWithBlank(expr) {
  for (let n = expr; n; n = n.type === 'filter' ? n.target : n.type === 'call' ? n.args[0] : null) {
    const name = n.type === 'filter' ? n.name : n.type === 'call' ? pathOf(n.callee) || '' : '';
    if (name.toLowerCase() === 'blank') return true;
    if (n.type !== 'filter' && n.type !== 'call') break;
  }
  return false;
}

/**
 * Render an AST with data.
 * @param {Object} ast   from parse()
 * @param {Object} data  answers
 * @param {RenderOptions} [options]
 * @returns {{text:string, warnings:string[], trace:{referenced:Set<string>, missing:Set<string>, relevant:Set<string>}}}
 */
export function render(ast, data, options = {}) {
  const fns = options.functions ? { ...builtins, ...options.functions } : builtins;
  const warnings = [];
  const warned = new Set();
  const trace = createTrace();
  trace.relevant = new Set();
  const warn = (msg) => { if (!warned.has(msg)) { warned.add(msg); warnings.push(msg); } };

  const evalIn = (expr, scope, src, node) => {
    const local = createTrace();
    let value;
    try {
      value = evalExpr(expr, scope, local, fns);
    } catch (e) {
      if (options.strict) throw e;
      warn(`Error in {[${src}]} on line ${node.line}: ${e.message}`);
      value = undefined;
    }
    for (const p of local.referenced) { trace.referenced.add(p); trace.relevant.add(p); }
    for (const p of local.missing) trace.missing.add(p);
    return { value, missing: local.missing };
  };

  // With a model, only `date`-typed variables get ISO text reformatted as a date.
  const fieldOpts = (node, value) => {
    if (!options.model || !options.model.variables || typeof value !== 'string') return options;
    const p = pathOf(node.expr);
    const def = p ? options.model.variables[p] : null;
    return def && def.type !== 'date' && def.type !== 'computed' ? { ...options, autoDates: false } : options;
  };

  const out = [];
  const renderBody = (body, scope) => {
    for (const node of body) renderNode(node, scope);
  };

  const renderNode = (node, scope) => {
    switch (node.type) {
      case 'text': out.push(node.value); break;
      case 'comment': break;
      case 'field': {
        const { value, missing } = evalIn(node.expr, scope, node.src, node);
        const text = formatValue(value, fieldOpts(node, value));
        if (text === '' && (value == null || value === '') && !endsWithBlank(node.expr)) {
          const p0 = pathOf(node.expr);
          const paths = missing.size ? [...missing] : p0 && p0.startsWith('_') ? [] : [p0 || node.src];
          for (const p of paths) warn(`Missing value: ${p}`);
          out.push(options.missingText ?? '');
        } else out.push(text);
        break;
      }
      case 'if': {
        let taken = false;
        for (const br of node.branches) {
          const { value } = evalIn(br.cond, scope, br.src, br);
          if (truthy(value)) { renderBody(br.body, scope); taken = true; break; }
        }
        if (!taken && node.elseBody) renderBody(node.elseBody, scope);
        break;
      }
      case 'list': {
        const { ast: listExpr, punc } = stripPuncFilter(node.expr);
        const { value } = evalIn(listExpr, scope, node.src, node);
        const items = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
        const id = listIdentity(listExpr);
        const outerPrefix = prefixOf(scope);
        // Resolve the list's full path: inner lists nested on the item use the item prefix.
        let prefix;
        if (id && id.startsWith('_')) prefix = outerPrefix ? outerPrefix + '.' + id + '[]' : id + '[]';
        else if (id && outerPrefix && !(id in (rootVars(scope) || {})) && !hasKeyCI(rootVars(scope), id.split('.')[0]) && hasKeyCI(scope.vars, id.split('.')[0])) prefix = outerPrefix + '.' + id + '[]';
        else prefix = (id || node.src) + '[]';
        // Knackly auto-punctuates: with `|punc:"1, 2, and 3"` and no explicit {[_punc]} in the body,
        // the separator is appended after each item automatically.
        const autoPunc = punc && !JSON.stringify(node.body).includes('_punc');
        items.forEach((item, i) => {
          const itemScope = createScope(itemVars(item, i, items.length, node.itemName, punc), scope, prefix);
          renderBody(node.body, itemScope);
          if (autoPunc) out.push(puncFor(punc, i, items.length));
        });
        break;
      }
      case 'root': renderBody(node.body, scope); break;
      default: throw new TemplateError(`Unknown node type ${node.type}`, node.line, node.col);
    }
  };

  renderNode(ast, createScope(data || {}));
  return { text: out.join(''), warnings, trace };
}

function prefixOf(scope) { for (let s = scope; s; s = s.parent) if (s.prefix) return s.prefix; return null; }
function rootVars(scope) { let s = scope; while (s.parent) s = s.parent; return s.vars; }
function hasKeyCI(obj, key) {
  if (!obj || typeof obj !== 'object') return false;
  const lk = String(key).toLowerCase();
  return Object.keys(obj).some((k) => k.toLowerCase() === lk);
}

/**
 * Render and split into lines. The docx/html layer converts lines to blocks
 * (markdown-ish structure: "# Heading", "**bold**", "---", "|a|b|", ">center").
 * @param {Object} ast
 * @param {Object} data
 * @param {RenderOptions} [options]
 * @returns {{lines:string[], text:string, warnings:string[], trace:Object}}
 */
export function renderToBlocks(ast, data, options = {}) {
  const r = render(ast, data, options);
  const lines = r.text.replace(/\r\n?/g, '\n').split('\n');
  return { lines, ...r };
}
