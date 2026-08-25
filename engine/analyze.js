/**
 * @module analyze
 * Static + dynamic analysis of a template AST: discovers variables, infers
 * types, computes relevance against current answers, and builds the
 * auto-questionnaire.
 */

import { collectIdentifiers, collectFunctions, evalExpr, createScope, createTrace, truthy, pathOf, listIdentity, stripPuncFilter } from './expr.js';
import { functions as builtins } from './functions.js';
import { itemVars } from './evaluate.js';

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
 * Humanize a path: "Client.IsMarried" → "Client — Is married?", "SigningDate" → "Signing date".
 * @param {string} path
 * @returns {string}
 */
export function humanize(path) {
  const segs = String(path).replace(/\[\]/g, '').split('.').filter(Boolean);
  return segs.map((seg, i) => humanizeName(seg, i === segs.length - 1)).join(' — ');
}
function humanizeName(name, isLeaf) {
  const words = name
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/);
  const keepUpper = (w) => /^(DOB|SSN|EIN|ID|LLC|LLP|PC|USA|US|UK|ZIP|URL|ABN|DBA|PO|APN)$/i.test(w) && w === w.toUpperCase();
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
    const name = segs[segs.length - 1];
    let parent = segs.length > 1 ? segs.slice(0, -1).join('.') : null;
    let isListItemField = false, listPath = null;
    if (parent && parent.endsWith('[]')) { listPath = parent.slice(0, -2); parent = listPath; isListItemField = true; }
    else if (parent && parent.includes('[]')) { isListItemField = true; listPath = parent.slice(0, parent.lastIndexOf('[]')); }
    const info = { path, name, parent, inferredType: 'text', typeRank: -1, options: undefined, usedIn: [], gatedBy: [], filters: [], isListItemField, listPath, contexts: new Set() };
    variables.set(path, info);
    if (parent) {
      const p = ensure(parent, ctx);
      setType(p, isListItemField && listPath === parent ? 'list' : 'object', 10);
    }
    return info;
  };

  const setType = (info, type, rank = TYPE_RANK[type] ?? 0) => {
    if (rank > info.typeRank || (rank === info.typeRank && info.inferredType === 'text')) { info.inferredType = type; info.typeRank = rank; }
  };

  /**
   * Resolve an identifier path to its full variable path given the list context stack.
   * @param {string} p raw dotted path from an expression
   * @param {Array<{prefix:string, itemName?:string}>} lists
   */
  const resolve = (p, lists) => {
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
      const info = ensure(path);
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
      if (n.type === 'filter' && LIST_FUNCS.has(n.name.toLowerCase()) && pathOf(n.target) === raw && n.name.toLowerCase() !== 'len' && n.name.toLowerCase() !== 'length') setType(info, 'list');
      if (n.type === 'filter' && pathOf(n.target) === raw) {
        const f = n.name.toLowerCase();
        if (CURRENCY_FILTERS.has(f)) setType(info, 'currency');
        else if (NUMBER_FILTERS.has(f)) setType(info, 'number');
        else if (DATE_FILTERS.has(f)) setType(info, 'date');
        else if (f === 'format') {
          const a0 = n.args[0];
          const arg = a0 && a0.type === 'literal' ? String(a0.value) : '';
          if (/^[#9,0$]*[.]?[#90]*%?$/.test(arg) && /[#90]/.test(arg)) setType(info, 'number');
          else setType(info, 'date');
        }
        else if (GENDER_FILTERS.has(f)) { setType(info, 'selection'); info.options = ['male', 'female', 'neutral']; }
      }
      if (n.type === 'call') {
        const fname = (pathOf(n.callee) || '').toLowerCase();
        const argIdx = n.args.findIndex((a) => pathOf(a) === raw);
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
    if (context === 'condition' && isBare) setType(info, 'boolean');
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
          if (base) { const li = ensure(base); setType(li, 'list', 10); }
          walkBody(n.body, [...lists, { prefix, itemName: n.itemName }], conds);
          break;
        }
        default: break;
      }
    }
  };
  walkBody(ast.body, [], []);

  for (const v of variables.values()) { delete v.typeRank; v.contexts = [...v.contexts]; }
  return { variables, structure };
}

function walkExpr(n, fn) {
  if (!n) return;
  fn(n);
  switch (n.type) {
    case 'member': walkExpr(n.object, fn); break;
    case 'index': walkExpr(n.object, fn); walkExpr(n.index, fn); break;
    case 'unary': walkExpr(n.arg, fn); break;
    case 'binary': walkExpr(n.left, fn); walkExpr(n.right, fn); break;
    case 'call': n.args.forEach((a) => walkExpr(a, fn)); break;
    case 'filter': walkExpr(n.target, fn); n.args.forEach((a) => walkExpr(a, fn)); break;
    default: break;
  }
}

const isBlankValue = (v) => v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));

/**
 * Read a dotted path (case-insensitive fallback) from data. "Children[0].Name" is supported.
 */
export function getPath(data, path) {
  let v = data;
  for (const seg of String(path).split('.')) {
    const m = /^(.+?)\[(\d+)\]$/.exec(seg);
    const key = m ? m[1] : seg;
    if (v == null || typeof v !== 'object') return undefined;
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
 *   relevant (recorded in `blockedBy`), but the condition's own variables are.
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
    const trace = createTrace();
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
              // cannot decide: everything below is blocked by this condition
              const blockedVars = [...staticVars(b.body, lists)];
              for (const nb of n.branches.slice(n.branches.indexOf(b) + 1)) blockedVars.push(...collectIdentifiers(nb.cond), ...staticVars(nb.body, lists));
              if (n.elseBody) blockedVars.push(...staticVars(n.elseBody, lists));
              for (const v of blockedVars) if (!relevantSet.has(v)) block(v, b.src);
              done = true;
              break;
            }
            if (truthy(r.value)) { walkBody(b.body, scope, lists); done = true; break; }
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
 * @returns {Array<{path:string,label:string,type:string,required:boolean,options?:string[],listPath?:string,answered:boolean,help?:string}>}
 */
export function questionnaire(ast, data, model) {
  const analysis = analyze(ast);
  const rel = relevantVariables(ast, data, { analysis });
  const out = [];
  const seen = new Set();
  for (const path of rel.relevant) {
    const info = analysis.variables.get(path);
    const def = model && model.variables ? model.variables[path] : null;
    const type = def ? def.type : info ? info.inferredType : 'text';
    if (type === 'object' || type === 'computed') continue;
    if (def && def.orphaned) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const q = {
      path,
      label: def && def.label ? def.label : humanize(path),
      type,
      required: def ? def.required !== false : true,
      answered: !rel.unanswered.some((u) => u.replace(/\[\d+\]/g, '[]') === path),
    };
    const options = def && def.options ? def.options : info && info.options;
    if (options && options.length) q.options = options;
    if (info && info.listPath) q.listPath = info.listPath;
    if (def && def.help) q.help = def.help;
    out.push(q);
  }
  return out;
}

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
