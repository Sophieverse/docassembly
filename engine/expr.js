/**
 * @module expr
 * Expression parser and evaluator for the template language (Knackly-compatible).
 *
 * Precedence, lowest → highest:
 *   pipe      := ternary ('|' IDENT (':' arg (('' | ',' | ':') arg)*)?)*
 *   ternary   := or ('?' ternary ':' ternary)?
 *   or        := and (('or' | '||') and)*
 *   and       := not (('and' | '&&') not)*
 *   not       := 'not' not | equality
 *   equality  := relational (('=' | '==' | '!=' | '<>') relational)*
 *   relational:= additive (('<' | '<=' | '>' | '>=') additive)*
 *   additive  := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative := unary (('*' | '/' | '%') unary)*
 *   unary     := ('-' | '+' | '!') unary | postfix
 *   postfix   := primary ('.' IDENT | '(' args ')' | '[' expr ']')*
 *   primary   := NUMBER | STRING | true | false | null | this | IDENT | '(' pipe ')'
 */

import { TemplateError } from './lexer.js';
import { functions as builtins, namespaces, methods as valueMethods, parseDate, isDateLike, parsePuncExample } from './functions.js';

/**
 * @typedef {Object} ExprAST
 * @property {string} type  'literal'|'ident'|'member'|'unary'|'binary'|'call'|'filter'|'index'|'ternary'|'this'
 */

// ---------------------------------------------------------------- tokenizer

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'null', 'this']);
const OPS = ['==', '!=', '<>', '<=', '>=', '&&', '||', '=', '<', '>', '!', '+', '-', '*', '/', '%', '(', ')', '[', ']', ',', '.', ':', '|', '?'];

function lexExpr(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\.?/.exec(src.slice(i));
      toks.push({ t: 'num', v: parseFloat(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1, out = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) { j++; const e = src[j]; out += e === 'n' ? '\n' : e === 't' ? '\t' : e; }
        else out += src[j];
        j++;
      }
      if (j >= src.length) throw new TemplateError(`Unterminated string literal in expression: ${src}`);
      toks.push({ t: 'str', v: out, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
      const w = m[0];
      const lw = w.toLowerCase();
      if (KEYWORDS.has(lw)) toks.push({ t: 'kw', v: lw, pos: i });
      else toks.push({ t: 'id', v: w, pos: i });
      i += w.length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new TemplateError(`Unexpected character "${ch}" in expression: ${src}`);
    toks.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  toks.push({ t: 'eof', v: null, pos: src.length });
  return toks;
}

// ---------------------------------------------------------------- parser

class Parser {
  constructor(src) { this.src = src; this.toks = lexExpr(src); this.i = 0; }
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  isOp(v) { const t = this.peek(); return t.t === 'op' && t.v === v; }
  isKw(v) { const t = this.peek(); return t.t === 'kw' && t.v === v; }
  expectOp(v) {
    if (!this.isOp(v)) throw new TemplateError(`Expected "${v}" in expression: ${this.src}`);
    return this.next();
  }
  parse() {
    const ast = this.pipe();
    if (this.peek().t !== 'eof') throw new TemplateError(`Unexpected "${this.peek().v}" in expression: ${this.src}`);
    return ast;
  }
  pipe() {
    let left = this.ternary();
    while (this.isOp('|')) {
      this.next();
      const nameTok = this.next();
      if (nameTok.t !== 'id' && nameTok.t !== 'kw') throw new TemplateError(`Expected filter name after "|" in expression: ${this.src}`);
      const args = [];
      if (this.isOp(':')) {
        this.next();
        args.push(this.ternary());
        while (this.isOp(',') || this.isOp(':')) { this.next(); args.push(this.ternary()); }
      }
      left = { type: 'filter', name: nameTok.v, target: left, args };
    }
    return left;
  }
  ternary() {
    const cond = this.or();
    if (this.isOp('?')) {
      this.next();
      const a = this.ternary();
      this.expectOp(':');
      const b = this.ternary();
      return { type: 'ternary', cond, a, b };
    }
    return cond;
  }
  or() {
    let left = this.and();
    while (this.isKw('or') || this.isOp('||')) { this.next(); left = { type: 'binary', op: 'or', left, right: this.and() }; }
    return left;
  }
  and() {
    let left = this.not();
    while (this.isKw('and') || this.isOp('&&')) { this.next(); left = { type: 'binary', op: 'and', left, right: this.not() }; }
    return left;
  }
  not() {
    if (this.isKw('not')) { this.next(); return { type: 'unary', op: 'not', arg: this.not() }; }
    return this.equality();
  }
  equality() {
    let left = this.relational();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && ['=', '==', '!=', '<>'].includes(t.v)) {
        this.next();
        const op = t.v === '==' ? '=' : t.v === '<>' ? '!=' : t.v;
        left = { type: 'binary', op, left, right: this.relational() };
      } else return left;
    }
  }
  relational() {
    let left = this.additive();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && ['<', '<=', '>', '>='].includes(t.v)) {
        this.next();
        left = { type: 'binary', op: t.v, left, right: this.additive() };
      } else return left;
    }
  }
  additive() {
    let left = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) { const op = this.next().v; left = { type: 'binary', op, left, right: this.multiplicative() }; }
    return left;
  }
  multiplicative() {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) { const op = this.next().v; left = { type: 'binary', op, left, right: this.unary() }; }
    return left;
  }
  unary() {
    if (this.isOp('-')) { this.next(); return { type: 'unary', op: '-', arg: this.unary() }; }
    if (this.isOp('+')) { this.next(); return { type: 'unary', op: '+', arg: this.unary() }; }
    if (this.isOp('!')) { this.next(); return { type: 'unary', op: 'not', arg: this.unary() }; }
    return this.postfix();
  }
  postfix() {
    let node = this.primary();
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        const t = this.next();
        if (t.t !== 'id' && t.t !== 'kw') throw new TemplateError(`Expected property name after "." in expression: ${this.src}`);
        node = { type: 'member', object: node, property: t.v };
      } else if (this.isOp('(') && (node.type === 'ident' || node.type === 'member')) {
        this.next();
        const args = [];
        if (!this.isOp(')')) { args.push(this.pipe()); while (this.isOp(',')) { this.next(); args.push(this.pipe()); } }
        this.expectOp(')');
        node = { type: 'call', callee: node, args };
      } else if (this.isOp('[')) {
        this.next();
        const index = this.pipe();
        this.expectOp(']');
        node = { type: 'index', object: node, index };
      } else break;
    }
    return node;
  }
  primary() {
    const t = this.next();
    if (t.t === 'num' || t.t === 'str') return { type: 'literal', value: t.v };
    if (t.t === 'kw') {
      if (t.v === 'true') return { type: 'literal', value: true };
      if (t.v === 'false') return { type: 'literal', value: false };
      if (t.v === 'null') return { type: 'literal', value: null };
      if (t.v === 'this') return { type: 'this' };
      throw new TemplateError(`Unexpected keyword "${t.v}" in expression: ${this.src}`);
    }
    if (t.t === 'id') return { type: 'ident', name: t.v };
    if (t.t === 'op' && t.v === '(') { const inner = this.pipe(); this.expectOp(')'); return inner; }
    if (t.t === 'eof') throw new TemplateError(`Unexpected end of expression: ${this.src}`);
    throw new TemplateError(`Unexpected "${t.v}" in expression: ${this.src}`);
  }
}

/**
 * Parse an expression source string into an AST.
 * @param {string} src
 * @returns {ExprAST}
 * @throws {TemplateError}
 */
export function parseExpr(src) {
  const s = String(src == null ? '' : src).trim();
  if (!s) throw new TemplateError('Empty expression');
  return new Parser(s).parse();
}

// ---------------------------------------------------------------- helpers

/**
 * Template truthiness: "", null, undefined, 0, false, [] and NaN are false.
 * @param {any} v
 * @returns {boolean}
 */
export function truthy(v) {
  if (v == null || v === false || v === '' || v === 0) return false;
  if (typeof v === 'number' && Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function isNumeric(v) {
  return (typeof v === 'number' && !Number.isNaN(v)) || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
}

/**
 * Compare two values sensibly: dates by time, numbers numerically, strings lexicographically.
 * @returns {number|null} negative/zero/positive, or null if incomparable
 */
export function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null || b == null) return null;
  if ((a instanceof Date || isDateLike(a)) && (b instanceof Date || isDateLike(b))) {
    const da = parseDate(a), db = parseDate(b);
    if (da && db) return da.getTime() - db.getTime();
  }
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Loose equality used by `=` / `==` / `!=`. */
export function valuesEqual(a, b) {
  const emptyA = a == null || a === '', emptyB = b == null || b === '';
  if (emptyA && emptyB) return true;
  if (emptyA || emptyB) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => valuesEqual(x, b[i]));
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    if (typeof a === 'string') return a.toLowerCase() === String(b);
    if (typeof b === 'string') return b.toLowerCase() === String(a);
    return a === b;
  }
  if (typeof a === 'string' && typeof b === 'string' && !isNumeric(a) && !isDateLike(a)) return a === b;
  return compareValues(a, b) === 0;
}

// ---------------------------------------------------------------- scope

/** @typedef {{vars:Object, parent:Scope|null, prefix?:string|null}} Scope */

/**
 * Create a scope. Lookup walks `parent` links.
 * @param {Object} vars
 * @param {Scope} [parent]
 * @param {string} [prefix] dotted prefix used when tracing references inside list items (e.g. "Children[]")
 * @returns {Scope}
 */
export function createScope(vars, parent = null, prefix = null) {
  return { vars: vars || {}, parent, prefix };
}

function hasOwn(obj, key) { return obj != null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key); }

/** Case-tolerant property read: exact key, then case-insensitive match. */
function readProp(obj, key) {
  if (obj == null) return { found: false, value: undefined };
  if (typeof obj !== 'object') {
    if (typeof obj === 'string' && key === 'length') return { found: true, value: obj.length };
    return { found: false, value: undefined };
  }
  if (hasOwn(obj, key)) return { found: true, value: obj[key] };
  if (Array.isArray(obj) && key === 'length') return { found: true, value: obj.length };
  if (obj instanceof Date) return { found: false, value: undefined };
  const lk = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lk) return { found: true, value: obj[k] };
  return { found: false, value: undefined };
}

function lookup(scope, name) {
  for (let s = scope; s; s = s.parent) {
    const r = readProp(s.vars, name);
    if (r.found) return { scope: s, value: r.value };
  }
  return null;
}

function innermostPrefix(scope) { for (let s = scope; s; s = s.parent) if (s.prefix) return s.prefix; return null; }

/**
 * Convert an AST that is a bare identifier / member chain into a dotted path string.
 * @param {ExprAST} ast
 * @returns {string|null}
 */
export function pathOf(ast) {
  if (!ast) return null;
  if (ast.type === 'ident') return ast.name;
  if (ast.type === 'this') return 'this';
  if (ast.type === 'member') { const p = pathOf(ast.object); return p ? `${p}.${ast.property}` : null; }
  if (ast.type === 'index' && ast.index.type === 'literal' && typeof ast.index.value === 'number') {
    const p = pathOf(ast.object); return p ? `${p}[${ast.index.value}]` : null;
  }
  return null;
}

/**
 * The dotted path a list-valued expression is "about", looking through filters and list calls.
 * `Children|filter: Age < 18` → "Children"; `sort(Children, "Name")` → "Children".
 * @param {ExprAST} ast
 * @returns {string|null}
 */
export function listIdentity(ast) {
  if (!ast) return null;
  if (ast.type === 'filter') return listIdentity(ast.target);
  if (ast.type === 'call' && ast.args.length && LAZY_FILTERS.has((pathOf(ast.callee) || '').toLowerCase())) return listIdentity(ast.args[0]);
  return pathOf(ast);
}

// ---------------------------------------------------------------- evaluator

/**
 * @typedef {Object} Trace
 * @property {Set<string>} referenced  every dotted path read
 * @property {Set<string>} missing     paths that resolved to undefined/blank
 */

/** Create an empty trace object. */
export function createTrace() { return { referenced: new Set(), missing: new Set() }; }

/** Filters/functions whose expression arguments are evaluated per list item. */
export const LAZY_FILTERS = new Set(['filter', 'where', 'find', 'any', 'all', 'every', 'some', 'sum', 'sort', 'sortby', 'orderby', 'map', 'count', 'group', 'groupby', 'reduce', 'min', 'max']);

function record(trace, set, path) {
  if (!trace || !trace[set] || !path) return;
  if (path.split('.').some((seg) => seg.startsWith('_') || seg === 'this')) return; // _index, _punc, this … are not variables
  trace[set].add(path);
}

/**
 * Full traced path of an ident/member chain given scope (adds list prefix when the
 * root resolves inside a list item, or is missing inside a list).
 */
function tracedPath(ast, scope) {
  const p = pathOf(ast);
  if (!p || p === 'this') return innermostPrefix(scope) ? innermostPrefix(scope).replace(/\[\]$/, '') : null;
  const root = p.split('.')[0].replace(/\[\d+\]$/, '');
  const hit = lookup(scope, root);
  const prefix = hit ? hit.scope.prefix : innermostPrefix(scope);
  return (prefix ? prefix + '.' : '') + p;
}

function resolvePath(ast, scope, trace, functions) {
  const parts = [];
  let n = ast;
  while (n.type === 'member') { parts.unshift(n.property); n = n.object; }
  if (n.type !== 'ident') {
    let v = evalNode(n, scope, trace, functions);
    for (const p of parts) v = readProp(v, p).value;
    return { value: v, path: null };
  }
  parts.unshift(n.name);
  const hit = lookup(scope, parts[0]);
  if (!hit) {
    const root = parts[0];
    const lroot = root.toLowerCase();
    if (parts.length === 1 && typeof functions[root] === 'function') return { value: functions[root](), path: null }; // {[today]}
    if (namespaces[lroot]) { // date.today etc.
      let v = namespaces[lroot];
      for (let i = 1; i < parts.length; i++) v = readProp(v, parts[i]).value;
      return { value: v, path: null };
    }
    const prefix = innermostPrefix(scope);
    const fullPath = (prefix ? prefix + '.' : '') + parts.join('.');
    record(trace, 'referenced', fullPath);
    record(trace, 'missing', fullPath);
    return { value: undefined, path: fullPath };
  }
  let value = hit.value;
  let path = (hit.scope.prefix ? hit.scope.prefix + '.' : '') + parts[0];
  record(trace, 'referenced', path);
  for (let i = 1; i < parts.length; i++) {
    path += '.' + parts[i];
    const r = readProp(value, parts[i]);
    if (!r.found) {
      if (valueMethods[parts[i]] && value != null && typeof value !== 'object') return { value: undefined, path, method: parts[i], receiver: value };
      record(trace, 'referenced', path);
      record(trace, 'missing', path);
      return { value: undefined, path };
    }
    record(trace, 'referenced', path);
    value = r.value;
  }
  if (value === undefined || value === null || value === '') record(trace, 'missing', path);
  return { value, path };
}

function callFunction(name, args, functions) {
  const fn = functions[name] || functions[name.toLowerCase()];
  if (typeof fn !== 'function') throw new TemplateError(`Unknown function "${name}"`);
  return fn(...args);
}

function toList(v) { return Array.isArray(v) ? v : v == null || v === '' ? [] : [v]; }

/**
 * Evaluate lazily-scoped list operations such as `Children|filter: Age < 18`.
 * Inside the per-item expression: bare names → item fields, `this` → the item,
 * `_result` → accumulator (reduce), `_index` etc. are available.
 */
function evalLazy(name, list, argAsts, scope, trace, functions, prefix) {
  const arr = toList(list);
  const itemScope = (item, i, extra) => {
    const vars = item != null && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date) ? { ...item } : {};
    vars._item = item; vars._index = i + 1; vars._index0 = i; vars._count = arr.length; vars.this = item;
    Object.assign(vars, extra);
    return createScope(vars, scope, prefix);
  };
  const per = (ast, item, i, extra) => evalNode(ast, itemScope(item, i, extra), trace, functions);
  const lname = name.toLowerCase();
  const [a0, a1] = argAsts;
  switch (lname) {
    case 'filter': case 'where': return arr.filter((it, i) => truthy(per(a0, it, i)));
    case 'find': return arr.find((it, i) => truthy(per(a0, it, i)));
    case 'any': case 'some': return arr.some((it, i) => truthy(per(a0, it, i)));
    case 'all': case 'every': return arr.length > 0 && arr.every((it, i) => truthy(per(a0, it, i)));
    case 'count': return arr.filter((it, i) => truthy(per(a0, it, i))).length;
    case 'sum': return arr.reduce((s, it, i) => s + (Number(per(a0, it, i)) || 0), 0);
    case 'min': case 'max': {
      const vals = arr.map((it, i) => per(a0, it, i)).filter((v) => v != null && v !== '');
      if (!vals.length) return '';
      return vals.reduce((m, v) => ((compareValues(v, m) || 0) * (lname === 'min' ? -1 : 1) > 0 ? v : m));
    }
    case 'map': return arr.map((it, i) => per(a0, it, i));
    case 'sort': case 'sortby': case 'orderby': {
      const keys = argAsts.map((a) => (a.type === 'unary' && (a.op === '-' || a.op === '+') ? { ast: a.arg, desc: a.op === '-' } : { ast: a, desc: false }));
      const keyed = arr.map((it, i) => ({ it, ks: keys.map((k) => per(k.ast, it, i)) }));
      keyed.sort((x, y) => {
        for (let k = 0; k < keys.length; k++) {
          const c = compareValues(x.ks[k], y.ks[k]) || 0;
          if (c) return keys[k].desc ? -c : c;
        }
        return 0;
      });
      return keyed.map((x) => x.it);
    }
    case 'group': case 'groupby': {
      const groups = new Map();
      arr.forEach((it, i) => { const k = per(a0, it, i); const key = k instanceof Date ? k.toISOString() : k; if (!groups.has(key)) groups.set(key, { _key: k, _values: [] }); groups.get(key)._values.push(it); });
      return [...groups.values()];
    }
    case 'reduce': {
      let acc = a1 ? evalNode(a1, scope, trace, functions) : undefined;
      arr.forEach((it, i) => { acc = per(a0, it, i, { _result: acc }); });
      return acc;
    }
    default: return undefined;
  }
}

function isLazyArgs(argAsts) {
  return argAsts.length >= 1 && !(argAsts[0].type === 'literal');
}

function lazyPrefix(targetAst, scope) {
  const id = listIdentity(targetAst);
  if (!id) return innermostPrefix(scope);
  const base = tracedPath({ type: 'ident', name: id.split('.')[0] }, scope);
  const rest = id.split('.').slice(1).join('.');
  return (base ? base + (rest ? '.' + rest : '') : id) + '[]';
}

function evalNode(ast, scope, trace, functions) {
  switch (ast.type) {
    case 'literal': return ast.value;
    case 'this': { const hit = lookup(scope, 'this'); return hit ? hit.value : lookup(scope, '_item')?.value; }
    case 'ident':
    case 'member': {
      const r = resolvePath(ast, scope, trace, functions);
      if (r.method) return valueMethods[r.method](r.receiver); // property-style method e.g. Name.length handled by readProp; others called bare
      return r.value;
    }
    case 'index': {
      const obj = evalNode(ast.object, scope, trace, functions);
      const idx = evalNode(ast.index, scope, trace, functions);
      if (obj == null) return undefined;
      if (Array.isArray(obj) && typeof idx === 'number') return obj[idx];
      return readProp(obj, String(idx)).value;
    }
    case 'ternary': return truthy(evalNode(ast.cond, scope, trace, functions)) ? evalNode(ast.a, scope, trace, functions) : evalNode(ast.b, scope, trace, functions);
    case 'unary': {
      const v = evalNode(ast.arg, scope, trace, functions);
      if (ast.op === 'not') return !truthy(v);
      if (ast.op === '-') return v == null || v === '' ? 0 : -Number(v);
      if (ast.op === '+') return isNumeric(v) ? Number(v) : v;
      throw new TemplateError(`Unknown unary operator ${ast.op}`);
    }
    case 'binary': {
      if (ast.op === 'and') { const l = evalNode(ast.left, scope, trace, functions); if (!truthy(l)) return false; return truthy(evalNode(ast.right, scope, trace, functions)); }
      if (ast.op === 'or') { const l = evalNode(ast.left, scope, trace, functions); if (truthy(l)) return true; return truthy(evalNode(ast.right, scope, trace, functions)); }
      const l = evalNode(ast.left, scope, trace, functions);
      const r = evalNode(ast.right, scope, trace, functions);
      switch (ast.op) {
        case '=': return valuesEqual(l, r);
        case '!=': return !valuesEqual(l, r);
        case '<': { const c = compareValues(l, r); return c != null && c < 0; }
        case '<=': { const c = compareValues(l, r); return c != null && c <= 0; }
        case '>': { const c = compareValues(l, r); return c != null && c > 0; }
        case '>=': { const c = compareValues(l, r); return c != null && c >= 0; }
        case '+': {
          if (l == null && r == null) return undefined;
          if (isNumeric(l) && isNumeric(r)) return Number(l) + Number(r);
          if (typeof l === 'number' && (r == null || r === '')) return l;
          if (typeof r === 'number' && (l == null || l === '')) return r;
          if (Array.isArray(l) && Array.isArray(r)) return l.concat(r);
          if ((l instanceof Date || isDateLike(l)) && isNumeric(r)) return functions.addDays(l, Number(r));
          return (l == null ? '' : String(l)) + (r == null ? '' : String(r));
        }
        case '-': {
          if ((l instanceof Date || isDateLike(l)) && (r instanceof Date || isDateLike(r))) return functions.dateDiffDays(r, l);
          if ((l instanceof Date || isDateLike(l)) && isNumeric(r)) return functions.addDays(l, -Number(r));
          return (Number(l) || 0) - (Number(r) || 0);
        }
        case '*': return (Number(l) || 0) * (Number(r) || 0);
        case '/': { const d = Number(r) || 0; return d === 0 ? undefined : (Number(l) || 0) / d; }
        case '%': { const d = Number(r) || 0; return d === 0 ? undefined : (Number(l) || 0) % d; }
        default: throw new TemplateError(`Unknown operator ${ast.op}`);
      }
    }
    case 'call': {
      const callee = ast.callee;
      const name = pathOf(callee);
      const lname = name ? name.toLowerCase() : '';
      if (callee.type === 'member') {
        // namespace call (date.today()), method call (Name.toUpperCase()), or user function on an object
        const root = callee.object.type === 'ident' ? callee.object.name : null;
        const rootHit = root ? lookup(scope, root) : null;
        if (root && !rootHit && namespaces[root.toLowerCase()]) {
          const ns = namespaces[root.toLowerCase()];
          const fn = readProp(ns, callee.property).value;
          if (typeof fn !== 'function') throw new TemplateError(`Unknown function "${name}"`);
          return fn(...ast.args.map((a) => evalNode(a, scope, trace, functions)));
        }
        const recv = evalNode(callee.object, scope, trace, functions);
        const prop = callee.property;
        const own = readProp(recv, prop);
        if (own.found && typeof own.value === 'function') return own.value(...ast.args.map((a) => evalNode(a, scope, trace, functions)));
        const method = valueMethods[prop] || valueMethods[prop.toLowerCase()];
        if (method) {
          if (LAZY_FILTERS.has(prop.toLowerCase()) && isLazyArgs(ast.args)) return evalLazy(prop, recv, ast.args, scope, trace, functions, lazyPrefix(callee.object, scope));
          return method(recv, ...ast.args.map((a) => evalNode(a, scope, trace, functions)));
        }
        if (recv == null) return undefined;
        throw new TemplateError(`Unknown method "${prop}"`);
      }
      if (name && LAZY_FILTERS.has(lname) && ast.args.length >= 2 && isLazyArgs(ast.args.slice(1))) {
        const list = evalNode(ast.args[0], scope, trace, functions);
        return evalLazy(lname, list, ast.args.slice(1), scope, trace, functions, lazyPrefix(ast.args[0], scope));
      }
      if (lname === 'if' && ast.args.length >= 2) {
        const c = evalNode(ast.args[0], scope, trace, functions);
        return truthy(c) ? evalNode(ast.args[1], scope, trace, functions) : ast.args[2] ? evalNode(ast.args[2], scope, trace, functions) : '';
      }
      const args = ast.args.map((a) => evalNode(a, scope, trace, functions));
      if (name && typeof (functions[name] || functions[lname]) === 'function') return callFunction(name, args, functions);
      const hit = name ? lookup(scope, name) : null;
      if (hit && typeof hit.value === 'function') return hit.value(...args);
      throw new TemplateError(`Unknown function "${name}"`);
    }
    case 'filter': {
      const value = evalNode(ast.target, scope, trace, functions);
      const lname = ast.name.toLowerCase();
      if (LAZY_FILTERS.has(lname) && isLazyArgs(ast.args)) return evalLazy(lname, value, ast.args, scope, trace, functions, lazyPrefix(ast.target, scope));
      if (lname === 'punc' && ast.args[0] && ast.args[0].type === 'literal') return functions.punc(value, ast.args[0].value);
      const args = ast.args.map((a) => evalNode(a, scope, trace, functions));
      return callFunction(ast.name, [value, ...args], functions);
    }
    default:
      throw new TemplateError(`Unknown AST node type ${ast.type}`);
  }
}

/**
 * Evaluate an expression AST against a scope.
 * @param {ExprAST} ast
 * @param {Scope|Object} scope  a scope chain `{vars, parent}` or a plain data object
 * @param {Trace} [trace]      collects `referenced` and `missing` dotted paths
 * @param {Object} [functions] function library (defaults to built-ins)
 * @returns {any}
 */
export function evalExpr(ast, scope, trace, functions = builtins) {
  const sc = scope && typeof scope === 'object' && 'vars' in scope && 'parent' in scope ? scope : createScope(scope || {});
  return evalNode(ast, sc, trace, functions);
}

/**
 * Parse and evaluate in one step.
 * @param {string} src
 * @param {Scope|Object} scope
 * @param {Trace} [trace]
 */
export function evaluate(src, scope, trace) { return evalExpr(parseExpr(src), scope, trace); }

/**
 * If a `{[list ...]}` expression ends in `|punc:"1, 2, and 3"`, split it off.
 * @param {ExprAST} ast
 * @returns {{ast:ExprAST, punc:Object|null}}
 */
export function stripPuncFilter(ast) {
  if (ast && ast.type === 'filter' && ast.name.toLowerCase() === 'punc') {
    const ex = ast.args[0] && ast.args[0].type === 'literal' ? String(ast.args[0].value) : '1, 2, and 3';
    return { ast: ast.target, punc: parsePuncExample(ex) };
  }
  return { ast, punc: null };
}

/**
 * Static analysis: collect dotted identifier paths referenced by an expression,
 * including inside function args and filter args. Identifiers inside lazily
 * evaluated list-filter expressions (`Children|filter: Age < 18`) are reported as
 * item fields of that list ("Children[].Age"). Namespace and function names are excluded.
 * Order = first appearance.
 * @param {ExprAST} ast
 * @returns {string[]}
 */
export function collectIdentifiers(ast) {
  const out = [];
  const seen = new Set();
  const add = (p) => { if (p && !seen.has(p)) { seen.add(p); out.push(p); } };
  const walk = (n, prefix) => {
    if (!n) return;
    const pre = (p) => {
      if (!p || p === 'this') return null;
      if (p.split('.')[0].startsWith('_')) return null;
      return prefix ? prefix + '.' + p : p;
    };
    switch (n.type) {
      case 'literal': case 'this': return;
      case 'ident': add(pre(n.name)); return;
      case 'member': {
        const p = pathOf(n);
        if (p) {
          const root = p.split('.')[0];
          if (!prefix && namespaces[root.toLowerCase()]) return;
          add(pre(p)); return;
        }
        walk(n.object, prefix); return;
      }
      case 'index': walk(n.object, prefix); walk(n.index, prefix); return;
      case 'unary': walk(n.arg, prefix); return;
      case 'binary': walk(n.left, prefix); walk(n.right, prefix); return;
      case 'ternary': walk(n.cond, prefix); walk(n.a, prefix); walk(n.b, prefix); return;
      case 'call': {
        const name = pathOf(n.callee) || '';
        const lname = name.toLowerCase();
        if (n.callee.type === 'member') {
          const root = n.callee.object.type === 'ident' ? n.callee.object.name.toLowerCase() : null;
          if (!(root && namespaces[root] && !prefix)) walk(n.callee.object, prefix);
          const prop = n.callee.property.toLowerCase();
          if (LAZY_FILTERS.has(prop) && isLazyArgs(n.args)) {
            const id = listIdentity(n.callee.object);
            const p = id ? pre(id) : null;
            n.args.forEach((a) => walk(a, p ? p + '[]' : prefix));
            return;
          }
          n.args.forEach((a) => walk(a, prefix));
          return;
        }
        if (LAZY_FILTERS.has(lname) && n.args.length >= 2 && isLazyArgs(n.args.slice(1))) {
          walk(n.args[0], prefix);
          const id = listIdentity(n.args[0]);
          const p = id ? pre(id) : null;
          n.args.slice(1).forEach((a) => walk(a, p ? p + '[]' : prefix));
          return;
        }
        n.args.forEach((a) => walk(a, prefix));
        return;
      }
      case 'filter': {
        walk(n.target, prefix);
        if (LAZY_FILTERS.has(n.name.toLowerCase()) && isLazyArgs(n.args)) {
          const id = listIdentity(n.target);
          const p = id ? pre(id) : null;
          n.args.forEach((a) => walk(a, p ? p + '[]' : prefix));
          return;
        }
        n.args.forEach((a) => walk(a, prefix));
        return;
      }
      default: return;
    }
  };
  walk(ast, null);
  return out;
}

/**
 * Names of filters applied in an expression (innermost first), plus function names called.
 * @param {ExprAST} ast
 * @returns {{filters:string[], calls:string[]}}
 */
export function collectFunctions(ast) {
  const filters = [], calls = [];
  const walk = (n) => {
    if (!n) return;
    switch (n.type) {
      case 'filter': walk(n.target); n.args.forEach(walk); filters.push(n.name.toLowerCase()); return;
      case 'call': calls.push((pathOf(n.callee) || '').toLowerCase()); if (n.callee.type === 'member') walk(n.callee.object); n.args.forEach(walk); return;
      case 'unary': walk(n.arg); return;
      case 'binary': walk(n.left); walk(n.right); return;
      case 'ternary': walk(n.cond); walk(n.a); walk(n.b); return;
      case 'index': walk(n.object); walk(n.index); return;
      default: return;
    }
  };
  walk(ast);
  return { filters, calls };
}
