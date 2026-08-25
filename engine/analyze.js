/**
 * @module analyze
 * Static + dynamic analysis of a template AST: discovers variables, infers
 * types, computes relevance against current answers, and builds the
 * auto-questionnaire.
 */

import { collectIdentifiers, collectFunctions, evalExpr, createScope, createTrace, truthy, pathOf, listIdentity, stripPuncFilter, isEmptyObject } from './expr.js';
import { functions as builtins } from './functions.js';
import { itemVars } from './evaluate.js';
import { TemplateError } from './lexer.js';

/**
 * @typedef {Object} VarInfo
 * @property {string} path            dotted path; list item fields use "Children[].Name"
 * @property {string} name            last path segment
 * @property {string|null} parent     parent path ("Client" for "Client.Name", "Children" for "Children[].Name")
 * @property {string} inferredType    text|longtext|number|currency|date|boolean|selection|multiselect|object|list
 * @property {string[]} [options]     for selection types, literal values compared against
 * @property {Array<{line:number,col:number,context:'field'|'condition'|'list'}>} usedIn
 * @property {string[]} gatedBy       condition sources enclosing the variable's uses
 * @property {string[]} filters       filter/function names applied to it
 * @property {boolean} isListItemField
 * @property {string|null} listPath   the list this item field belongs to
 * @property {boolean} [hasValueCheck] the variable's `{[if X]}` uses are "has a value" checks on a printed value
 *                                    (so it is optional by nature — the template already copes with it blank)
 */

const LIST_FUNCS = new Set(['count', 'sum', 'any', 'all', 'first', 'last', 'join', 'sort', 'sortby', 'filter', 'where', 'map', 'pluck', 'reverse', 'unique', 'punc', 'len', 'length']);
const CURRENCY_FILTERS = new Set(['currency', 'dollars', 'dollarswords', 'dollarsfull', 'dollarsandcents', 'cents']);
const NUMBER_FILTERS = new Set(['number', 'words', 'ordinal', 'ordinalwords', 'round', 'abs', 'roman', 'alpha', 'pluralize', 'quantity', 'isare', 'hashave', 'doesdo', 'waswere']);
const DATE_FILTERS = new Set(['formatdate', 'adddays', 'addmonths', 'addyears', 'yearsbetween', 'age', 'datediffdays', 'year', 'month', 'day', 'monthname', 'weekday', 'date']);
const GENDER_FILTERS = new Set(['pronoun', 'salutation']);

// Name hints are camel-case aware: "StartDate" matches, "Candidate" does not.
const NAME_HINTS = [
  [/(Date|DOB|Birthday|Deadline|Expires|Expiry|Expiration)$/, 'date'],
  [/^(date|dob|birthday|deadline|expires|expiry|expiration)$/i, 'date'],
  [/(Amount|Fee|Price|Cost|Salary|Rent|Value|Total|Balance|Payment|Deposit|Retainer|Wage|Income|Compensation|Consideration|Principal|Debt|Damages)$/, 'currency'],
  [/^(amount|fee|price|cost|salary|rent|value|total|balance|payment|deposit|retainer|wage|income|compensation|consideration|principal|debt|damages)$/i, 'currency'],
  [/(Count|Number|Num|Qty|Quantity|Percent|Percentage|Age|Years|Months|Days|Term|Shares|Units|Hours)$/, 'number'],
  [/^(count|number|num|qty|quantity|percent|percentage|age|years|months|days|term|shares|units|hours)$/i, 'number'],
  [/^(Is|Has|Can|Should|Will|Does|Did|Wants|Needs|Include|Includes)[A-Z_]/, 'boolean'],
  [/^(is|has)$/i, 'boolean'],
  [/(Gender|Sex)$/, 'selection'],
  [/^(gender|sex)$/i, 'selection'],
  [/(Description|Notes?|Comments?|Narrative|Recitals?|Purpose|Address|Terms|Summary|Reason|Details?)$/, 'longtext'],
  [/^(description|notes?|comments?|narrative|recitals?|purpose|address|terms|summary|reason|details?)$/i, 'longtext'],
  [/(Email|EMail)$/, 'email'],
  [/^e-?mail$/i, 'email'],
  [/(Phone|Telephone|Mobile|Fax)$/, 'phone'],
  [/^(phone|telephone|mobile|fax)$/i, 'phone'],
];

const TYPE_RANK = { text: 0, email: 1, phone: 1, longtext: 1, selection: 2, number: 3, currency: 4, date: 4, boolean: 3, list: 6, object: 6 };

/**
 * Humanize a path: "Client.IsMarried" → "Client — Is married?", "SigningDate" → "Signing date",
 * "BuiltBefore1978" → "Built before 1978", "ROFRDays" → "ROFR days".
 * @param {string} path
 * @param {string} [type] variable type; a boolean label always ends with "?"
 * @returns {string}
 */
export function humanize(path, type) {
  const segs = String(path).replace(/\[\]/g, '').split('.').filter(Boolean);
  const out = segs.map((seg, i) => humanizeName(seg, i === segs.length - 1)).join(' — ');
  return type === 'boolean' && out && !out.endsWith('?') ? out + '?' : out;
}
function humanizeName(name, isLeaf) {
  const words = name
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  const keepUpper = (w) => (w.length >= 2 && /^[A-Z]+$/.test(w)) || (/^(DOB|SSN|EIN|ID|LLC|LLP|PC|USA|US|UK|ZIP|URL|ABN|DBA|PO|APN)$/i.test(w) && w === w.toUpperCase());
  const out = words.map((w, i) => (keepUpper(w) ? w.toUpperCase() : i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ');
  const q = isLeaf && /^(Is|Has|Can|Should|Will|Does|Did|Wants|Needs|Includes?)\s/.test(out);
  return q ? out + '?' : out;
}

/**
 * Split "A.B[].C" into segments ["A","B[]","C"].
 */
function segments(path) { return String(path).split('.'); }

/**
 * Static analysis. Discovers every variable, where it is used, what gates it,
 * and infers a type.
 * @param {Object} ast from parse()
 * @returns {{variables: Map<string, VarInfo>, structure: Object[]}}
 */
export function analyze(ast) {
  const variables = new Map();
  const structure = [];

  // Pass 1: top-level roots referenced outside of any list body.
  const topRoots = new Set();
  const pass1 = (nodes, inList) => {
    for (const n of nodes) {
      if (n.type === 'field' && !inList) collectIdentifiers(n.expr).forEach((p) => topRoots.add(p.split('.')[0]));
      if (n.type === 'if') {
        for (const b of n.branches) { if (!inList) collectIdentifiers(b.cond).forEach((p) => topRoots.add(p.split('.')[0])); pass1(b.body, inList); }
        if (n.elseBody) pass1(n.elseBody, inList);
      }
      if (n.type === 'list') { if (!inList) collectIdentifiers(n.expr).forEach((p) => topRoots.add(p.split('.')[0])); pass1(n.body, true); }
    }
  };
  pass1(ast.body, false);

  const ensure = (path, ctx) => {
    if (variables.has(path)) return variables.get(path);
    const segs = segments(path);
    // `{[Client.constructor]}` / `{[__proto__.x]}` would compile into a variable no answer can ever reach
    // (getPath/setPath refuse those keys): reject at compile time, as a template error.
    for (const s of segs) if (!isSafeKey(s.replace(/\[\]$/, ''))) throw new TemplateError(`"${path}" is not a valid variable name (${s.replace(/\[\]$/, '')} is reserved)`, ctx && ctx.line, ctx && ctx.col);
    const name = segs[segs.length - 1];
    let parent = segs.length > 1 ? segs.slice(0, -1).join('.') : null;
    let isListItemField = false, listPath = null;
    if (parent && parent.endsWith('[]')) { listPath = parent.slice(0, -2); parent = listPath; isListItemField = true; }
    else if (parent && parent.includes('[]')) { isListItemField = true; listPath = parent.slice(0, parent.lastIndexOf('[]')); }
    // A list is registered before its item fields so it always precedes them in discovery (question) order, even
    // when a concrete-index reference (`{[Trusts[0].Name]}`) appears before the `{[list Trusts]}` block. Object
    // parents keep following their first field, as before.
    const isList = isListItemField && listPath === parent;
    const p = parent && isList ? ensure(parent, ctx) : null;
    const info = { path, name, parent, inferredType: 'text', typeRank: -1, altType: 'text', altRank: -1, options: undefined, usedIn: [], gatedBy: [], filters: [], isListItemField, listPath, contexts: new Set() };
    variables.set(path, info);
    if (parent) setType(p || ensure(parent, ctx), isList ? 'list' : 'object', 10);
    return info;
  };

  const setType = (info, type, rank = TYPE_RANK[type] ?? 0, fromBareCond = false) => {
    if (rank > info.typeRank || (rank === info.typeRank && info.inferredType === 'text')) { info.inferredType = type; info.typeRank = rank; }
    // Evidence other than a bare `{[if X]}` is remembered separately so a has-value check can be demoted later.
    if (!fromBareCond && (rank > info.altRank || (rank === info.altRank && info.altType === 'text'))) { info.altType = type; info.altRank = rank; }
  };
  /** The value node a filter chain / nested call is applied to: `Day|default:"1"|ordinal` → Day. */
  const chainRoot = (n) => { while (n && (n.type === 'filter' || (n.type === 'call' && n.args.length))) n = n.type === 'filter' ? n.target : n.args[0]; return n; };

  /**
   * Resolve an identifier path to its full variable path given the list context stack.
   * @param {string} p raw dotted path from an expression
   * @param {Array<{prefix:string, itemName?:string}>} lists
   */
  const resolve = (raw, lists) => {
    // `Children[0].Name` is a use of the item field Children[].Name; bare `Children[0]` is a use of the list.
    const p = raw.replace(/\[\d+\]/g, '[]').replace(/\[\]$/, '');
    const segs = p.split('.');
    if (segs[0].startsWith('_')) return null; // _index etc.
    for (let i = lists.length - 1; i >= 0; i--) {
      const L = lists[i];
      if (L.itemName && segs[0] === L.itemName) return segs.length > 1 ? L.prefix + '.' + segs.slice(1).join('.') : L.prefix.replace(/\[\]$/, '');
    }
    if (lists.length && !topRoots.has(segs[0]) && !hasRootCI(segs[0])) return lists[lists.length - 1].prefix + '.' + p;
    return p;
  };
  const hasRootCI = (name) => { const l = name.toLowerCase(); for (const r of topRoots) if (r.toLowerCase() === l) return true; return false; };

  const noteUse = (exprAst, node, context, lists, conds, extra = {}) => {
    const ids = collectIdentifiers(exprAst);
    const { filters, calls } = collectFunctions(exprAst);
    const isBare = exprAst.type === 'ident' || exprAst.type === 'member' || (exprAst.type === 'unary' && exprAst.op === 'not' && pathOf(exprAst.arg));
    for (const raw of ids) {
      const path = resolve(raw, lists);
      if (!path) continue;
      const info = ensure(path, node);
      info.usedIn.push({ line: node.line, col: node.col, context });
      info.contexts.add(context);
      for (const c of conds) if (!info.gatedBy.includes(c)) info.gatedBy.push(c);
      for (const f of filters) if (!info.filters.includes(f)) info.filters.push(f);
      inferFromExpr(info, exprAst, raw, context, isBare, filters, calls, extra);
    }
  };

  const inferFromExpr = (info, exprAst, raw, context, isBare, filters, calls, extra) => {
    if (extra.list && extra.listPath === info.path) { setType(info, 'list'); return; }
    // list-function usage: count(X), any(X, ...) → list
    walkExpr(exprAst, (n) => {
      if (n.type === 'call') {
        const fname = (pathOf(n.callee) || '').toLowerCase();
        if (LIST_FUNCS.has(fname) && n.args[0] && pathOf(n.args[0]) === raw) setType(info, 'list');
      }
      if (n.type === 'filter' && LIST_FUNCS.has(n.name.toLowerCase()) && pathOf(chainRoot(n.target)) === raw && n.name.toLowerCase() !== 'len' && n.name.toLowerCase() !== 'length' && !chainHasListReducer(n.target)) setType(info, 'list');
      if (n.type === 'filter' && pathOf(chainRoot(n.target)) === raw && !chainHasListReducer(n.target)) {
        const f = n.name.toLowerCase();
        if (CURRENCY_FILTERS.has(f)) setType(info, 'currency');
        else if (NUMBER_FILTERS.has(f)) setType(info, 'number');
        else if (DATE_FILTERS.has(f)) setType(info, 'date');
        else if (f === 'format') {
          const a0 = n.args[0], a1 = n.args[1];
          const arg = a0 && a0.type === 'literal' ? String(a0.value) : '';
          if (/^[#9,0$]*[.]?[#90]*%?$/.test(arg) && /[#90]/.test(arg)) setType(info, 'number');
          else if (a1 && a1.type === 'literal' && typeof a1.value === 'string' && a0 && a0.type === 'literal' && typeof a0.value === 'string') setType(info, 'boolean'); // format:"yes":"no"
          else setType(info, 'date');
        }
        else if (GENDER_FILTERS.has(f)) { setType(info, 'selection'); info.options = ['male', 'female', 'neutral']; }
      }
      if (n.type === 'call') {
        const fname = (pathOf(n.callee) || '').toLowerCase();
        const argIdx = n.args.findIndex((a) => pathOf(a) === raw);
        if (argIdx === -1 && n.args.length && pathOf(chainRoot(n.args[0])) === raw && !chainHasListReducer(n.args[0]) && n.args[0].type !== 'ident' && n.args[0].type !== 'member') {
          // ordinal(default(Day, "1")): the outer function types the chain's root value
          const fname2 = (pathOf(n.callee) || '').toLowerCase();
          if (CURRENCY_FILTERS.has(fname2)) setType(info, 'currency');
          else if (NUMBER_FILTERS.has(fname2)) setType(info, 'number');
          else if (DATE_FILTERS.has(fname2)) setType(info, 'date');
        }
        if (argIdx === 0) {
          if (CURRENCY_FILTERS.has(fname)) setType(info, 'currency');
          else if (NUMBER_FILTERS.has(fname)) setType(info, 'number');
          else if (DATE_FILTERS.has(fname)) setType(info, 'date');
          else if (fname === 'format') setType(info, 'date');
          else if (GENDER_FILTERS.has(fname)) { setType(info, 'selection'); info.options = ['male', 'female', 'neutral']; }
        } else if (argIdx === 1 && (fname === 'yearsbetween' || fname === 'datediffdays' || fname === 'age')) setType(info, 'date');
      }
      if (n.type === 'binary' && ['=', '!=', '<', '<=', '>', '>='].includes(n.op)) {
        const other = pathOf(n.left) === raw ? n.right : pathOf(n.right) === raw ? n.left : null;
        if (other && other.type === 'literal') {
          if (typeof other.value === 'number') setType(info, 'number');
          else if (typeof other.value === 'boolean') setType(info, 'boolean');
          else if (typeof other.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(other.value)) setType(info, 'date');
          else if (typeof other.value === 'string' && (n.op === '=' || n.op === '!=')) {
            setType(info, 'selection');
            info.options = info.options || [];
            if (!info.options.includes(other.value)) info.options.push(other.value);
          }
        }
      }
    });
    if (context === 'condition' && isBare) { info.bareCond = true; setType(info, 'boolean', TYPE_RANK.boolean, true); }
    else {
      info.nonBareUse = true;
      if (context === 'field' && !filters.length && !calls.length && (exprAst.type === 'ident' || exprAst.type === 'member') && pathOf(exprAst) === raw) info.plainField = true;
    }
    // name hints (lower priority than explicit filter evidence)
    if (info.typeRank < 3) {
      for (const [re, t] of NAME_HINTS) {
        if (re.test(info.name)) { setType(info, t, Math.max(TYPE_RANK[t] ?? 0, 2)); break; }
      }
    }
  };

  const walkBody = (nodes, lists, conds) => {
    for (const n of nodes) {
      switch (n.type) {
        case 'field': noteUse(n.expr, n, 'field', lists, conds); break;
        case 'if': {
          const entry = { type: 'if', line: n.line, col: n.col, endLine: n.endLine, branches: [], children: [] };
          structure.push(entry);
          const chain = [];
          for (const b of n.branches) {
            noteUse(b.cond, b, 'condition', lists, conds);
            const condSrc = chain.length ? `not (${chain.join(' or ')}) and (${b.src})` : b.src;
            entry.branches.push({ src: b.src, line: b.line, vars: collectIdentifiers(b.cond).map((p) => resolve(p, lists)).filter(Boolean) });
            walkBody(b.body, lists, [...conds, condSrc]);
            chain.push(b.src);
          }
          if (n.elseBody) walkBody(n.elseBody, lists, [...conds, `not (${chain.join(' or ')})`]);
          break;
        }
        case 'list': {
          const id = listIdentity(n.expr);
          const base = id ? resolve(id, lists) : n.src;
          noteUse(n.expr, n, 'list', lists, conds, { list: true, listPath: base });
          const prefix = (base || n.src) + '[]';
          structure.push({ type: 'list', line: n.line, col: n.col, endLine: n.endLine, src: n.src, path: base });
          if (base) { const li = ensure(base, n); setType(li, 'list', 10); }
          walkBody(n.body, [...lists, { prefix, itemName: n.itemName }], conds);
          break;
        }
        default: break;
      }
    }
  };
  walkBody(ast.body, [], []);

  const { annotations, annotationErrors } = collectAnnotations(ast, variables);

  const nameForcesBoolean = (v) => /^(Is|Has|Can|Should|Will|Does|Did|Wants|Needs|Includes?)[A-Z_]/.test(v.name) || /^(is|has)$/i.test(v.name);
  for (const v of variables.values()) {
    // `{[if Notes]}{[Notes]}{[end if]}` / `{[if Court]} in the {[Court|upper]}{[end if]}`: a bare condition on a
    // variable that is also printed, filtered, compared or passed to a function is a "has a value" check,
    // not a Yes/No question — unless the name itself says boolean (IsMarried, HasChildren).
    if (v.bareCond && v.nonBareUse && v.inferredType === 'boolean' && !nameForcesBoolean(v)) {
      // altType is the best evidence that is not a bare condition (a `format:"on":"off"` still says boolean)
      if (v.altRank >= 0) { v.inferredType = v.altType; v.typeRank = v.altRank; }
      else { v.inferredType = 'text'; v.typeRank = -1; for (const [re, t] of NAME_HINTS) if (re.test(v.name)) { setType(v, t, Math.max(TYPE_RANK[t] ?? 0, 2)); break; } }
    }
    // Either way (demoted here, or typed by a filter such as `{[Fee|currency]}` in the first place), a bare
    // `{[if X]}` on a printed non-boolean is a has-value check: the template already copes with X blank.
    if (v.bareCond && v.nonBareUse && v.inferredType !== 'boolean' && !nameForcesBoolean(v)) v.hasValueCheck = true;
    // A single literal comparison (`{[if State = "CA"]}…{[else]}`) is not enough for a choice list:
    // keep it text and offer the literal as a suggestion (options → model.inferredOptions).
    if (v.inferredType === 'selection' && (!v.options || v.options.length < 2)) {
      v.inferredType = 'text'; v.typeRank = -1;
      for (const [re, t] of NAME_HINTS) if (re.test(v.name)) { setType(v, t, Math.max(TYPE_RANK[t] ?? 0, 2)); break; }
    }
    delete v.typeRank; delete v.bareCond; delete v.plainField; delete v.nonBareUse; delete v.altType; delete v.altRank; v.contexts = [...v.contexts];
  }
  // A list with no item fields ({[Names|join]}, {[list Names]}{[_item]}{[end list]}) is a list of plain values.
  for (const v of variables.values()) {
    if (v.inferredType !== 'list') continue;
    const prefix = v.path + '[].';
    let hasChildren = false;
    for (const p of variables.keys()) if (p.startsWith(prefix)) { hasChildren = true; break; }
    if (!hasChildren) v.itemType = 'text';
  }

  return { variables, structure, annotations, annotationErrors };
}

/** Annotation keys understood in `{[# @key Path: value]}` comments. */
export const ANNOTATION_KEYS = ['label', 'help', 'options', 'default', 'required', 'optional', 'type', 'min', 'max', 'minlength', 'maxlength', 'pattern', 'validate', 'message', 'formula'];
const ANNOTATION_FIELD = { minlength: 'minLength', maxlength: 'maxLength' };

/**
 * Parse one `@key Path: value` line. Returns null when the line is not an annotation.
 * A concrete index in the path (`Children[0].Name`) is normalised to the generic form (`Children[].Name`).
 * @param {string} line
 * @returns {{key:string, path:string, value:string}|{error:string}|null}
 */
export function parseAnnotationLine(line) {
  const m = /^@([A-Za-z]+)\s+([\p{L}_$][\p{L}\p{N}_$]*(?:\[\d*\]|\.[\p{L}_$][\p{L}\p{N}_$]*)*)\s*(?::\s*(.*))?$/su.exec(line.trim());
  if (!m) return /^@[A-Za-z]+\b/.test(line.trim()) ? { error: `Cannot read annotation "${line.trim()}" (expected @key Path: value)` } : null;
  const key = m[1].toLowerCase();
  if (!ANNOTATION_KEYS.includes(key)) return { error: `Unknown annotation @${m[1]} (known: ${ANNOTATION_KEYS.map((k) => '@' + k).join(', ')})` };
  return { key, path: m[2].replace(/\[\d+\]/g, '[]'), value: (m[3] || '').trim() };
}

/** Strip one pair of matching surrounding quotes: `"Client's name"` → `Client's name`. */
const unquote = (s) => (/^"[^"]*"$/.test(s) || /^'[^']*'$/.test(s) ? s.slice(1, -1) : s);
/** Index of the first `::` outside string literals (the message may itself contain `::`), or -1. */
function messageSeparator(src) {
  let q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === ':' && src[i + 1] === ':') return i;
  }
  return -1;
}
const ANNOTATION_TYPES = ['text', 'longtext', 'number', 'currency', 'date', 'boolean', 'selection', 'multiselect', 'object', 'list', 'computed', 'email', 'phone'];

/**
 * Collect `@` annotations from every comment in the AST. One annotation per line;
 * a comment may hold several. Values are typed: numbers for @min/@max (ISO dates stay strings),
 * arrays for @options, `{expr, message}` for @validate, booleans for @required/@optional.
 *
 * - Inside a list body a bare path names the item field when the list has it: `{[list Children]}{[# @label DOB: …]}`
 *   annotates `Children[].DOB` (given `variables`; without them, any bare path inside a list body is prefixed).
 * - The same key twice for one path: the last wins and a warning points at the overridden line.
 * - With `variables`, an annotation for a path the template never uses is a warning (the variable is *not*
 *   created — except by `@formula` / `@type … computed`, which define computed variables).
 * - Each entry of `annotationErrors` carries `severity: 'error' | 'warning'`; positions of each key are kept on a
 *   non-enumerable `__pos` property of the annotation object so model-level checks can point at a line.
 * @param {Object} ast
 * @param {Map<string, Object>} [variables] from analyze(), for path resolution and unused-variable warnings
 * @returns {{annotations: Map<string, Object>, annotationErrors: Array<{message:string,line:number,col:number,severity:string}>}}
 */
export function collectAnnotations(ast, variables) {
  const annotations = new Map();
  const annotationErrors = [];
  const ensure = (path) => {
    if (!annotations.has(path)) { const o = {}; Object.defineProperty(o, '__pos', { value: {}, enumerable: false }); annotations.set(path, o); }
    return annotations.get(path);
  };
  const resolvePath = (path, lists) => {
    if (!lists.length) return path;
    const root = path.split('.')[0].replace(/\[\]$/, '');
    for (let i = lists.length - 1; i >= 0; i--) {
      const L = lists[i];
      if (L.itemName && root === L.itemName) return path.includes('.') ? L.prefix + '.' + path.slice(path.indexOf('.') + 1) : L.prefix.slice(0, -2);
      const cand = L.prefix + '.' + path;
      if (!variables) return cand;
      if (variables.has(cand) && !variables.has(path)) return cand;
    }
    return path;
  };
  const visit = (nodes, lists) => {
    for (const n of nodes) {
      if (n.type === 'comment') {
        const lines = String(n.value || '').split(/\r?\n/);
        lines.forEach((line, i) => {
          const a = parseAnnotationLine(line);
          if (!a) return;
          const pos = { line: n.line + i, col: n.col };
          if (a.error) { annotationErrors.push({ message: a.error, ...pos, severity: 'error' }); return; }
          const path = resolvePath(a.path, lists);
          const target = ensure(path);
          const field = ANNOTATION_FIELD[a.key] || (a.key === 'optional' ? 'required' : a.key);
          const setPos = (f = field) => {
            const prev = target.__pos[f];
            if (prev && target[f] !== undefined) annotationErrors.push({ message: `@${a.key} ${path}: overrides the @${prev.key} on line ${prev.line} (last one wins)`, ...pos, severity: 'warning' });
            target.__pos[f] = { ...pos, key: a.key };
          };
          switch (a.key) {
            case 'required': setPos(); target.required = a.value === '' ? true : !/^(false|no|0|off)$/i.test(a.value); break;
            case 'optional': setPos(); target.required = false; break;
            case 'options': setPos(); target.options = a.value.split('|').map((s) => unquote(s.trim())).filter(Boolean); break;
            case 'min': case 'max': setPos(); target[a.key] = /^-?\d+(\.\d+)?$/.test(a.value) ? Number(a.value) : a.value; break;
            case 'minlength': case 'maxlength': {
              const num = Number(a.value);
              if (!Number.isInteger(num) || num < 0) { annotationErrors.push({ message: `@${ANNOTATION_FIELD[a.key]} ${path}: expected a whole number, got "${a.value}"`, ...pos, severity: 'error' }); break; }
              setPos(); target[ANNOTATION_FIELD[a.key]] = num; break;
            }
            case 'pattern':
              { const problem = patternProblem(a.value);
                if (problem) annotationErrors.push({ message: `@pattern ${path}: ${problem}`, ...pos, severity: 'error' });
                else { setPos(); target.pattern = a.value; } }
              break;
            case 'validate': {
              const idx = messageSeparator(a.value);
              const expr = (idx === -1 ? a.value : a.value.slice(0, idx)).trim();
              if (!expr) { annotationErrors.push({ message: `@validate ${path}: missing expression`, ...pos, severity: 'error' }); break; }
              setPos(); target.validate = expr;
              if (idx !== -1) { setPos('message'); target.message = unquote(a.value.slice(idx + 2).trim()); }
              break;
            }
            case 'type': {
              const t = a.value.toLowerCase();
              if (!ANNOTATION_TYPES.includes(t)) { annotationErrors.push({ message: `@type ${path}: unknown type "${a.value}"`, ...pos, severity: 'error' }); break; }
              setPos(); target.type = t; break;
            }
            case 'formula': setPos(); target.formula = a.value; if (target.type === undefined) target.type = 'computed'; target.__pos.type = target.__pos.type || { ...pos, key: 'formula' }; break;
            default: setPos(); target[a.key] = unquote(a.value); break; // label, help, default, message
          }
        });
      }
      if (n.type === 'if') { for (const b of n.branches) visit(b.body, lists); if (n.elseBody) visit(n.elseBody, lists); }
      if (n.type === 'list') { const id = listIdentity(n.expr); visit(n.body, [...lists, { prefix: resolvePath(id || n.src, lists) + '[]', itemName: n.itemName }]); }
    }
  };
  visit(ast.body || [], []);
  if (variables) {
    for (const [path, ann] of annotations) {
      if (variables.has(path) || ann.formula !== undefined || ann.type === 'computed') continue;
      const first = Object.values(ann.__pos).sort((x, y) => x.line - y.line)[0] || { line: 0, col: 0, key: Object.keys(ann)[0] };
      annotationErrors.push({ message: `@${first.key} ${path}: the template does not use "${path}" (annotation ignored)`, line: first.line, col: first.col, severity: 'warning' });
    }
  }
  annotationErrors.sort((x, y) => x.line - y.line);
  return { annotations, annotationErrors };
}

/** Is there a list-reducing filter/call (count, join, sum…) between the chain root and this node? */
const LIST_REDUCERS = new Set(['count', 'sum', 'join', 'punc', 'first', 'last', 'len', 'length', 'any', 'all', 'every', 'some', 'find', 'reduce', 'min', 'max', 'group', 'groupby']);
function chainHasListReducer(n) {
  while (n && (n.type === 'filter' || n.type === 'call')) {
    const name = (n.type === 'filter' ? n.name : pathOf(n.callee) || '').toLowerCase();
    if (LIST_REDUCERS.has(name)) return true;
    n = n.type === 'filter' ? n.target : n.args[0];
  }
  return false;
}

function walkExpr(n, fn) {
  if (!n) return;
  fn(n);
  switch (n.type) {
    case 'member': walkExpr(n.object, fn); break;
    case 'index': walkExpr(n.object, fn); walkExpr(n.index, fn); break;
    case 'unary': walkExpr(n.arg, fn); break;
    case 'binary': walkExpr(n.left, fn); walkExpr(n.right, fn); break;
    case 'ternary': walkExpr(n.cond, fn); walkExpr(n.a, fn); walkExpr(n.b, fn); break;
    case 'call': n.args.forEach((a) => walkExpr(a, fn)); break;
    case 'filter': walkExpr(n.target, fn); n.args.forEach((a) => walkExpr(a, fn)); break;
    default: break;
  }
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** A property name that is safe to read/write on plain data objects. */
export function isSafeKey(key) { return !UNSAFE_KEYS.has(String(key).toLowerCase()); }

// ---------- user regular expressions (`@pattern`) ----------
// A pattern is user input that runs against user input in the browser tab: keep it small, refuse the classic
// catastrophic-backtracking shape (a quantified group whose body is itself quantified: `(a+)+`, `(\d*)*`,
// `(x+){2,}`), and only ever test a bounded slice of the value. Compiled RegExps are memoised.
export const MAX_PATTERN_LENGTH = 256;
export const MAX_PATTERN_INPUT = 4096;
const patternCache = new Map();

/**
 * The offending `(…)+` when a quantified group can end in a quantified atom (`(a+)+`, `(\d*)*`, `(x+){2,}`,
 * `((ab)+)*`) or repeats an alternation with quantifiers inside (`(a+|b)*`): the classic catastrophic-backtracking
 * shapes. A group whose last atom is fixed (`(\d+\.)*`, `(-\d{4})?`, `(\d{1,3}\.){3}`) is fine. Null when clean.
 */
function nestedQuantifier(src) {
  const quantAt = (i) => { const c = src[i]; return c === '*' || c === '+' || (c === '{' && /^\{\d+(,\d*)\}/.test(src.slice(i))); };
  const frames = [{ at: -1, lastQ: false, anyQ: false, alt: false }];
  let inClass = false;
  const top = () => frames[frames.length - 1];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inClass) { if (c === ']') { inClass = false; top().lastQ = false; } else if (c === '\\') i++; continue; }
    if (c === '\\') { i++; top().lastQ = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(') { frames.push({ at: i, lastQ: false, anyQ: false, alt: false }); continue; }
    if (c === ')') {
      if (frames.length === 1) return null; // unbalanced: RegExp reports it
      const g = frames.pop();
      const risky = g.lastQ || (g.alt && g.anyQ);
      const q = quantAt(i + 1);
      if (q && risky) { const m = /^[*+]|^\{\d+(,\d*)?\}/.exec(src.slice(i + 1)); return src.slice(g.at, i + 1 + m[0].length); }
      const parent = top();
      parent.anyQ = parent.anyQ || g.anyQ || q;
      parent.lastQ = q; // a quantified group is itself a repeated last atom
      continue;
    }
    if (c === '|') { top().alt = true; top().lastQ = false; continue; }
    if (c === '*' || c === '+' || c === '?' || (c === '{' && /^\{\d+(,\d*)?\}/.test(src.slice(i)))) {
      if (c === '{') { i = src.indexOf('}', i); }
      // `?` after a quantifier is the lazy flag, not a new quantifier; `{n}` is fixed and repeats nothing unboundedly
      const fixed = c === '{' && !src.slice(0, i + 1).match(/\{\d+,\d*\}$/);
      if (!fixed) { top().lastQ = true; top().anyQ = true; }
      continue;
    }
    top().lastQ = false;
  }
  return null;
}

/**
 * Why a `@pattern` source is not acceptable, or null when it is fine.
 * @param {string} pattern
 * @returns {string|null}
 */
export function patternProblem(pattern) {
  const src = String(pattern);
  if (src.length > MAX_PATTERN_LENGTH) return `pattern is longer than ${MAX_PATTERN_LENGTH} characters`;
  const nested = nestedQuantifier(src);
  if (nested) return `pattern has nested quantifiers (${nested}) and could hang on long input`;
  try { new RegExp(src); } catch (e) { return `invalid regular expression: ${e.message}`; }
  return null;
}

/**
 * Memoised RegExp for a checked pattern, or an Error describing the problem.
 * @param {string} pattern
 * @returns {RegExp|Error}
 */
export function compilePattern(pattern) {
  const src = String(pattern);
  let hit = patternCache.get(src);
  if (hit) return hit;
  const problem = patternProblem(src);
  hit = problem ? new Error(problem) : new RegExp(src);
  if (patternCache.size >= 512) patternCache.delete(patternCache.keys().next().value);
  patternCache.set(src, hit);
  return hit;
}

const isBlankValue = (v) => v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v)) || isEmptyObject(v);

/**
 * Read a dotted path (case-insensitive fallback) from data. "Children[0].Name" is supported.
 */
export function getPath(data, path) {
  let v = data;
  for (const seg of String(path).split('.')) {
    const m = /^(.+?)\[(\d+)\]$/.exec(seg);
    const key = m ? m[1] : seg;
    if (v == null || typeof v !== 'object' || !isSafeKey(key)) return undefined;
    let val = Object.prototype.hasOwnProperty.call(v, key) ? v[key] : undefined;
    if (val === undefined) { const k = Object.keys(v).find((x) => x.toLowerCase() === key.toLowerCase()); if (k !== undefined) val = v[k]; }
    if (m) val = Array.isArray(val) ? val[+m[2]] : undefined;
    v = val;
  }
  return v;
}

/**
 * Dynamic relevance: which variables matter given current answers.
 *
 * - Variables in text/fields are relevant when every enclosing branch currently holds.
 * - Condition variables are relevant as soon as the condition is reached.
 * - If a condition references unanswered variables, its branches' contents are not yet
 *   relevant (recorded in `blockedBy`), but the condition's own variables are — and so is any
 *   variable referenced on *every* remaining path through the `if` (each branch and the `else`),
 *   since it will be asked whichever way the gate is answered; it is ordered right after the gate.
 * - An empty plain object (`Client.Address: {}`) counts as unanswered, like `undefined`.
 * - Lists: the list variable is relevant; item fields are relevant per item
 *   (generic path "Children[].Name" in `relevant`, per-item "Children[0].Name" in `unanswered`).
 *
 * @param {Object} ast
 * @param {Object} data
 * @param {{analysis?:ReturnType<typeof analyze>, functions?:Object}} [options]
 * @returns {{relevant:string[], unanswered:string[], blockedBy:Map<string,string[]>, values:Map<string,any>}}
 */
export function relevantVariables(ast, data, options = {}) {
  const analysis = options.analysis || analyze(ast);
  const fns = options.functions ? { ...builtins, ...options.functions } : builtins;
  const relevant = [];
  const relevantSet = new Set();
  const unanswered = [];
  const unansweredSet = new Set();
  const blockedBy = new Map();
  const values = new Map();

  const addRelevant = (path) => {
    const info = analysis.variables.get(path);
    if (info && info.inferredType === 'object') return; // objects are containers, not questions
    if (!relevantSet.has(path)) { relevantSet.add(path); relevant.push(path); }
  };
  const addUnanswered = (path) => { if (!unansweredSet.has(path)) { unansweredSet.add(path); unanswered.push(path); } };
  const block = (path, cond) => { if (!blockedBy.has(path)) blockedBy.set(path, []); const a = blockedBy.get(path); if (!a.includes(cond)) a.push(cond); };

  const isLeaf = (genericPath) => { const v = analysis.variables.get(genericPath); return !v || (v.inferredType !== 'object'); };

  /** Convert a traced runtime path (with prefixes) into generic + concrete forms. */
  const generic = (p) => p.replace(/\[\d+\]/g, '[]');

  // Evaluate an expression in scope; return {value, referenced paths, unansweredPaths}
  const evalIn = (expr, scope) => {
    const trace = createTrace({ exhaustive: true });
    let value;
    try { value = evalExpr(expr, scope, trace, fns); } catch { value = undefined; }
    const missing = [...trace.missing].filter((p) => isLeaf(generic(p)) && !p.split('.').some((s) => s.startsWith('_')));
    return { value, referenced: [...trace.referenced], missing };
  };

  const noteRefs = (referenced, scope) => {
    for (const p of referenced) {
      if (p.split('.').some((s) => s.startsWith('_'))) continue;
      const g = generic(p);
      addRelevant(g);
      const idx = p.lastIndexOf('[]');
      const owned = idx === -1 || scopeHasPrefix(scope, p.slice(0, idx + 2));
      if (!owned) {
        // referenced inside a lazily evaluated list expression (e.g. Children|filter: Age < 18): check every item
        const listPath = p.slice(0, idx), rest = p.slice(idx + 3);
        const list = listPath.includes('[]') ? null : getPath(scope.rootData, listPath);
        if (Array.isArray(list) && isLeaf(g)) list.forEach((item, i) => { if (isBlankValue(getPath(item, rest))) addUnanswered(`${listPath}[${i}].${rest}`); });
        values.set(p, undefined);
        continue;
      }
      const v = lookupConcrete(p, scope);
      values.set(p, v);
      if (isLeaf(g) && isBlankValue(v) && !(analysis.variables.get(g)?.inferredType === 'list' && Array.isArray(v))) addUnanswered(concretize(p, scope));
    }
  };

  const scopeHasPrefix = (scope, prefix) => { for (let s = scope; s; s = s.parent) if (s.prefix === prefix) return true; return false; };
  const lookupConcrete = (tracePath, scope) => {
    // tracePath like "Children[].Name" traced with generic prefix; resolve using scope chain concrete data
    // A path containing "[]" belongs to the item scope with that prefix.
    const idx = tracePath.lastIndexOf('[]');
    if (idx === -1) return getPath(scope.rootData, tracePath);
    const prefix = tracePath.slice(0, idx + 2);
    for (let s = scope; s; s = s.parent) {
      if (s.prefix === prefix) return getPath(s.vars, tracePath.slice(idx + 3));
    }
    return undefined;
  };

  /** Concrete path for unanswered listing, e.g. Children[0].Name */
  const concretize = (p, scope) => {
    let out = p;
    for (let s = scope; s; s = s.parent) if (s.prefix && s.index != null) out = out.split(s.prefix).join(s.prefix.slice(0, -2) + '[' + s.index + ']');
    return out;
  };

  const staticVars = (nodes, lists) => {
    // all variable paths (generic) inside a body, for blockedBy
    const out = [];
    const resolveStatic = (p, ls) => {
      const segs = p.split('.');
      if (segs[0].startsWith('_')) return null;
      for (let i = ls.length - 1; i >= 0; i--) if (ls[i].itemName && segs[0] === ls[i].itemName) return segs.length > 1 ? ls[i].prefix + '.' + segs.slice(1).join('.') : ls[i].prefix.slice(0, -2);
      if (ls.length) {
        const cand = ls[ls.length - 1].prefix + '.' + p;
        if (analysis.variables.has(cand)) return cand;
      }
      return p;
    };
    const rec = (ns, ls) => {
      const res = (p) => resolveStatic(p, ls);
      for (const n of ns) {
        if (n.type === 'field') collectIdentifiers(n.expr).map(res).forEach((p) => p && out.push(p));
        if (n.type === 'if') { for (const b of n.branches) { collectIdentifiers(b.cond).map(res).forEach((p) => p && out.push(p)); rec(b.body, ls); } if (n.elseBody) rec(n.elseBody, ls); }
        if (n.type === 'list') {
          collectIdentifiers(n.expr).map(res).forEach((p) => p && out.push(p));
          const id = listIdentity(n.expr);
          const base = id ? res(id) : n.src;
          rec(n.body, [...ls, { prefix: base + '[]', itemName: n.itemName }]);
        }
      }
    };
    rec(nodes, lists);
    return out;
  };

  /**
   * Variables referenced on every path through a body (generic paths): fields and condition subjects
   * at this level, plus what is definite in *all* branches of an `if` that has an `else`. List bodies
   * are never definite (the list may be empty); the list expression's own variables are.
   */
  const definiteVars = (nodes, lists) => {
    const out = new Set();
    const res = (p) => {
      const segs = p.split('.');
      if (segs[0].startsWith('_')) return null;
      for (let i = lists.length - 1; i >= 0; i--) if (lists[i].itemName && segs[0] === lists[i].itemName) return segs.length > 1 ? lists[i].prefix + '.' + segs.slice(1).join('.') : lists[i].prefix.slice(0, -2);
      if (lists.length) { const cand = lists[lists.length - 1].prefix + '.' + p; if (analysis.variables.has(cand)) return cand; }
      return p;
    };
    for (const n of nodes) {
      if (n.type === 'field') collectIdentifiers(n.expr).map(res).forEach((p) => p && out.add(p));
      else if (n.type === 'list') collectIdentifiers(n.expr).map(res).forEach((p) => p && out.add(p));
      else if (n.type === 'if') {
        collectIdentifiers(n.branches[0].cond).map(res).forEach((p) => p && out.add(p));
        for (const p of definiteAcross(n, 0, lists)) out.add(p);
      }
    }
    return out;
  };
  /** Intersection of definiteVars over branches[from..] and the else body; empty without an else. */
  const definiteAcross = (n, from, lists) => {
    if (!n.elseBody) return new Set();
    let acc = null;
    for (const body of [...n.branches.slice(from).map((b) => b.body), n.elseBody]) {
      const d = definiteVars(body, lists);
      acc = acc === null ? d : new Set([...acc].filter((p) => d.has(p)));
      if (!acc.size) break;
    }
    return acc || new Set();
  };

  const walkBody = (nodes, scope, lists) => {
    for (const n of nodes) {
      switch (n.type) {
        case 'field': { const r = evalIn(n.expr, scope); noteRefs(r.referenced, scope); break; }
        case 'if': {
          let done = false;
          for (const b of n.branches) {
            const r = evalIn(b.cond, scope);
            noteRefs(r.referenced, scope);
            if (r.missing.length) {
              const bi = n.branches.indexOf(b);
              // Whatever the answer, these will be asked: make them relevant now, right after the gate.
              for (const p of definiteAcross(n, bi, lists)) {
                if (!isLeaf(p) || analysis.variables.get(p)?.inferredType === 'object') continue;
                const idx = p.lastIndexOf('[]');
                if (idx !== -1 && !scopeHasPrefix(scope, p.slice(0, idx + 2))) continue; // item of a list inside the branch
                addRelevant(p);
                const v = lookupConcrete(p, scope);
                values.set(p, v);
                if (isBlankValue(v) && !(analysis.variables.get(p)?.inferredType === 'list' && Array.isArray(v))) addUnanswered(concretize(p, scope));
              }
              // cannot decide: everything else below is blocked by this condition
              const blockedVars = [...staticVars(b.body, lists)];
              for (const nb of n.branches.slice(bi + 1)) blockedVars.push(...collectIdentifiers(nb.cond), ...staticVars(nb.body, lists));
              if (n.elseBody) blockedVars.push(...staticVars(n.elseBody, lists));
              for (const v of blockedVars) if (!relevantSet.has(v)) block(v, b.src);
              done = true;
              break;
            }
            if (truthy(r.value) && !isEmptyObject(r.value)) { walkBody(b.body, scope, lists); done = true; break; } // `{}` = unanswered
          }
          if (!done && n.elseBody) walkBody(n.elseBody, scope, lists);
          break;
        }
        case 'list': {
          const r = evalIn(n.expr, scope);
          noteRefs(r.referenced, scope);
          const id = listIdentity(n.expr);
          const base = id ? (r.referenced.find((p) => generic(p).endsWith(id)) || id) : n.src;
          const prefix = base + '[]';
          const items = Array.isArray(r.value) ? r.value : r.value == null || r.value === '' ? [] : [r.value];
          if (!Array.isArray(r.value) && r.value == null) {
            for (const v of staticVars(n.body, [...lists, { prefix, itemName: n.itemName }])) if (!relevantSet.has(v)) block(v, n.src);
          }
          items.forEach((item, i) => {
            const sc = createScope(itemVars(item, i, items.length, n.itemName), scope, prefix);
            sc.index = i; sc.rootData = scope.rootData;
            walkBody(n.body, sc, [...lists, { prefix, itemName: n.itemName }]);
          });
          break;
        }
        default: break;
      }
    }
  };

  const root = createScope(data || {});
  root.rootData = data || {};
  walkBody(ast.body, root, []);
  return { relevant, unanswered, blockedBy, values };
}

/**
 * Build the ordered questionnaire for the current answers.
 * @param {Object} ast
 * @param {Object} data
 * @param {Object} [model] from model.js (custom labels/types/options); optional
 * @returns {Array<{path:string,label:string,type:string,required:boolean,options?:string[],listPath?:string,answered:boolean,help?:string,min?:number|string,max?:number|string,minLength?:number,maxLength?:number,pattern?:string,default?:any}>}
 */
export function questionnaire(ast, data, model) {
  const analysis = analyze(ast);
  const rel = relevantVariables(ast, data, { analysis });
  const out = [];
  const seen = new Set();
  for (const path of questionOrder(rel.relevant, analysis)) {
    const info = analysis.variables.get(path);
    const def = model && model.variables ? model.variables[path] : null;
    const type = def ? def.type : info ? info.inferredType : 'text';
    if (type === 'object' || type === 'computed') continue;
    if (def && def.orphaned) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const q = {
      path,
      label: def && def.label ? def.label : humanize(path, type),
      type,
      required: def ? def.required !== false : true,
      answered: !rel.unanswered.some((u) => u.replace(/\[\d+\]/g, '[]') === path),
    };
    const options = def && def.options ? def.options : info && info.options;
    if (options && options.length && (type === 'selection' || type === 'multiselect')) q.options = options;
    else if (options && options.length && ['text', 'longtext'].includes(type)) q.suggestions = options;
    if (info && info.listPath) q.listPath = info.listPath;
    const itemType = def && def.itemType ? def.itemType : info && info.itemType;
    if (type === 'list' && itemType) q.itemType = itemType;
    if (def && def.help) q.help = def.help;
    if (def) {
      for (const k of ['min', 'max', 'minLength', 'maxLength', 'pattern', 'default']) if (def[k] !== undefined && def[k] !== null && def[k] !== '') q[k] = def[k];
      if (def.fromTemplate && Object.keys(def.fromTemplate).length) q.fromTemplate = { ...def.fromTemplate };
    }
    out.push(q);
  }
  return out;
}

/**
 * Question order (see docs/engine-additions.md "Question order"). Only currently relevant questions are
 * shown, but their *order* is a property of the template, not of the answers, so answering never reorders:
 * 1. document position — a variable sorts by its first reference anywhere in the template (field, condition
 *    or list expression, inside any branch). A condition's subjects therefore precede everything they gate,
 *    and a variable used on every path through a gate follows the gate directly.
 * 2. object grouping — every question under the same top-level root (`Client.*`, `Trusts[].*`) is moved up
 *    to the root's first appearance, keeping document order within the group. Top-level scalars are their own
 *    group.
 * Without `analysis`, the incoming (relevance) order is the position key.
 * @param {string[]} relevant generic paths in relevance order
 * @param {{variables: Map<string, Object>}} [analysis] from analyze(); its insertion order is document order
 * @returns {string[]}
 */
export function questionOrder(relevant, analysis) {
  const pos = new Map();
  if (analysis && analysis.variables) { let i = 0; for (const p of analysis.variables.keys()) pos.set(p, i++); }
  const n = pos.size;
  const key = (p, i) => (pos.has(p) ? pos.get(p) : n + i);
  const anchor = new Map();
  relevant.forEach((p, i) => { const root = rootOf(p); const k = key(p, i); if (!anchor.has(root) || k < anchor.get(root)) anchor.set(root, k); });
  return relevant.map((p, i) => ({ p, i, k: key(p, i), a: anchor.get(rootOf(p)) })).sort((x, y) => x.a - y.a || x.k - y.k || x.i - y.i).map((x) => x.p);
}
const rootOf = (p) => p.split('.')[0].replace(/\[\]$/, '');

/**
 * Designer view: for each variable, the conditions/sections it gates.
 * @param {Object} ast
 * @returns {Map<string, Array<{kind:'if'|'list', condition:string, line:number, endLine:number, gates:string[]}>>}
 */
export function dependencyMap(ast) {
  const analysis = analyze(ast);
  const map = new Map();
  const add = (v, entry) => { if (!map.has(v)) map.set(v, []); map.get(v).push(entry); };
  const resolveIn = (p, lists) => {
    const segs = p.split('.');
    if (segs[0].startsWith('_')) return null;
    for (let i = lists.length - 1; i >= 0; i--) if (lists[i].itemName && segs[0] === lists[i].itemName) return segs.length > 1 ? lists[i].prefix + '.' + segs.slice(1).join('.') : lists[i].prefix.slice(0, -2);
    if (lists.length) { const c = lists[lists.length - 1].prefix + '.' + p; if (analysis.variables.has(c)) return c; }
    return p;
  };
  const gated = (nodes, lists) => {
    const out = new Set();
    const rec = (ns, ls) => {
      for (const n of ns) {
        if (n.type === 'field') collectIdentifiers(n.expr).forEach((p) => { const r = resolveIn(p, ls); if (r) out.add(r); });
        if (n.type === 'if') { for (const b of n.branches) { collectIdentifiers(b.cond).forEach((p) => { const r = resolveIn(p, ls); if (r) out.add(r); }); rec(b.body, ls); } if (n.elseBody) rec(n.elseBody, ls); }
        if (n.type === 'list') { collectIdentifiers(n.expr).forEach((p) => { const r = resolveIn(p, ls); if (r) out.add(r); }); const id = listIdentity(n.expr); rec(n.body, [...ls, { prefix: (id ? resolveIn(id, ls) : n.src) + '[]', itemName: n.itemName }]); }
      }
    };
    rec(nodes, lists);
    return [...out];
  };
  const walk = (nodes, lists) => {
    for (const n of nodes) {
      if (n.type === 'if') {
        for (const b of n.branches) {
          const vars = collectIdentifiers(b.cond).map((p) => resolveIn(p, lists)).filter(Boolean);
          const entry = { kind: 'if', condition: b.src, line: b.line, endLine: n.endLine ?? b.line, gates: gated(b.body, lists) };
          for (const v of vars) add(v, entry);
          walk(b.body, lists);
        }
        if (n.elseBody) walk(n.elseBody, lists);
      }
      if (n.type === 'list') {
        const id = listIdentity(n.expr);
        const base = id ? resolveIn(id, lists) : n.src;
        const inner = [...lists, { prefix: base + '[]', itemName: n.itemName }];
        const entry = { kind: 'list', condition: n.src, line: n.line, endLine: n.endLine ?? n.line, gates: gated(n.body, inner) };
        collectIdentifiers(n.expr).map((p) => resolveIn(p, lists)).filter(Boolean).forEach((v) => add(v, entry));
        walk(n.body, inner);
      }
    }
  };
  walk(ast.body, []);
  return map;
}
