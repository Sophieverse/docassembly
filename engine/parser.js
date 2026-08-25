/**
 * @module parser
 * Builds a template AST from template text.
 *
 * Node types:
 *   {type:'text', value, line, col}
 *   {type:'field', expr, src, line, col}
 *   {type:'if', branches:[{cond, src, body, line, col}], elseBody, line, col, endLine, endCol}
 *   {type:'list', expr, src, body, itemName?, line, col, endLine, endCol}
 *   {type:'comment', value, line, col}
 * Root: {type:'root', body:[...]}
 */

import { tokenize, TemplateError } from './lexer.js';
import { parseExpr } from './expr.js';

const RE = {
  comment: /^#/,
  if: /^if\b\s*(.*)$/is,
  elseif: /^(?:else\s*if|elif)\b\s*(.*)$/is,
  else: /^else$/i,
  endif: /^(?:end\s*if)$/i,
  list: /^(?:list|repeat|foreach|for\s+each)\b\s*(.*)$/is,
  endlist: /^(?:end\s*(?:list|repeat|foreach|for\s+each))$/i,
  end: /^end$/i,
};

/**
 * Classify a field token's contents.
 * @param {string} v
 * @returns {{kind:string, arg?:string, itemName?:string}}
 */
export function classifyTag(v) {
  const s = v.trim();
  let m;
  if (RE.comment.test(s)) return { kind: 'comment', arg: s.slice(1).trim() };
  if (RE.endif.test(s)) return { kind: 'endif' };
  if (RE.endlist.test(s)) return { kind: 'endlist' };
  if (RE.end.test(s)) return { kind: 'end' };
  if (RE.else.test(s)) return { kind: 'else' };
  if ((m = RE.elseif.exec(s))) return { kind: 'elseif', arg: m[1].trim() };
  // A bare keyword written with capitals ("{[List]}", "{[If]}") is a variable named that way.
  if ((m = RE.if.exec(s))) return m[1].trim() === '' && s !== 'if' ? { kind: 'field', arg: s } : { kind: 'if', arg: m[1].trim() };
  if ((m = RE.list.exec(s))) {
    let arg = m[1].trim();
    if (arg === '' && s !== s.toLowerCase()) return { kind: 'field', arg: s };
    let itemName;
    const as = /^(.*?)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/is.exec(arg);
    if (as) { arg = as[1].trim(); itemName = as[2]; }
    return { kind: 'list', arg, itemName };
  }
  return { kind: 'field', arg: s };
}

const STRUCTURAL = new Set(['comment', 'if', 'elseif', 'else', 'endif', 'list', 'endlist', 'end']);

/**
 * Remove the line a structural tag sits on when it is alone on that line
 * (only whitespace around it). Mutates text token values in place.
 * @param {import('./lexer.js').Token[]} tokens
 */
function stripStandaloneTagLines(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'field') continue;
    if (!STRUCTURAL.has(classifyTag(t.value).kind)) continue;
    const prev = tokens[i - 1], next = tokens[i + 1];
    if (prev && prev.type !== 'text') continue;
    if (next && next.type !== 'text') continue;
    const prevVal = prev ? prev.value : '';
    const nextVal = next ? next.value : '';
    const nl = prevVal.lastIndexOf('\n');
    const tail = prevVal.slice(nl + 1);
    if (!/^[ \t]*$/.test(tail)) continue;
    if (nl === -1 && prevVal !== '' && i > 1) continue; // whitespace after a value field on the same line → not alone
    const headMatch = /^[ \t]*(\r?\n|$)/.exec(nextVal);
    if (!headMatch) continue;
    if (next && nextVal.length > 0 && headMatch[1] === '' && headMatch[0].length !== nextVal.length) continue;
    // Standalone → drop trailing whitespace of prev line and the newline that follows the tag.
    if (prev) prev.value = prevVal.slice(0, nl + 1);
    if (next) next.value = nextVal.slice(headMatch[0].length);
  }
}

function safeParseExpr(src, line, col, what) {
  try {
    return parseExpr(src);
  } catch (e) {
    throw new TemplateError(`${what ? what + ': ' : ''}${e.message.replace(/ \(line \d+, col \d+\)$/, '')}`, line, col);
  }
}

/**
 * Parse template text into an AST.
 * @param {string} templateText
 * @returns {{type:'root', body:Array}}
 * @throws {TemplateError} on syntax errors / unbalanced blocks
 */
export function parse(templateText) {
  const tokens = tokenize(templateText);
  stripStandaloneTagLines(tokens);

  const root = { type: 'root', body: [], line: 1, col: 1 };
  /** stack frames: {node, kind:'if'|'list', current: bodyArray} */
  const stack = [{ node: root, kind: 'root', current: root.body }];
  const top = () => stack[stack.length - 1];

  for (const t of tokens) {
    if (t.type === 'text') {
      if (t.value !== '') top().current.push({ type: 'text', value: t.value, line: t.line, col: t.col });
      continue;
    }
    const tag = classifyTag(t.value);
    const { line, col } = t;
    switch (tag.kind) {
      case 'comment':
        top().current.push({ type: 'comment', value: tag.arg, line, col });
        break;
      case 'field':
        top().current.push({ type: 'field', expr: safeParseExpr(tag.arg, line, col, 'Bad field'), src: tag.arg, line, col });
        break;
      case 'if': {
        if (!tag.arg) throw new TemplateError('{[if]} needs a condition', line, col);
        const branch = { cond: safeParseExpr(tag.arg, line, col, 'Bad {[if]} condition'), src: tag.arg, body: [], line, col };
        const node = { type: 'if', branches: [branch], elseBody: null, line, col };
        top().current.push(node);
        stack.push({ node, kind: 'if', current: branch.body });
        break;
      }
      case 'elseif': {
        const f = top();
        if (f.kind !== 'if') throw new TemplateError(`{[else if]} on line ${line} is not inside an {[if]} block`, line, col);
        if (f.node.elseBody) throw new TemplateError(`{[else if]} on line ${line} comes after {[else]}`, line, col);
        if (!tag.arg) throw new TemplateError('{[else if]} needs a condition', line, col);
        const branch = { cond: safeParseExpr(tag.arg, line, col, 'Bad {[else if]} condition'), src: tag.arg, body: [], line, col };
        f.node.branches.push(branch);
        f.current = branch.body;
        break;
      }
      case 'else': {
        const f = top();
        if (f.kind !== 'if') throw new TemplateError(`{[else]} on line ${line} is not inside an {[if]} block`, line, col);
        if (f.node.elseBody) throw new TemplateError(`Duplicate {[else]} on line ${line}`, line, col);
        f.node.elseBody = [];
        f.current = f.node.elseBody;
        break;
      }
      case 'endif': {
        const f = top();
        if (f.kind !== 'if') {
          if (f.kind === 'list') throw new TemplateError(`{[end if]} on line ${line} closes {[list]} opened on line ${f.node.line}; expected {[end list]}`, line, col);
          throw new TemplateError(`{[end if]} on line ${line} has no matching {[if]}`, line, col);
        }
        f.node.endLine = line; f.node.endCol = col;
        stack.pop();
        break;
      }
      case 'list': {
        if (!tag.arg) throw new TemplateError('{[list]} needs a list expression', line, col);
        const node = { type: 'list', expr: safeParseExpr(tag.arg, line, col, 'Bad {[list]} expression'), src: tag.arg, body: [], itemName: tag.itemName, line, col };
        top().current.push(node);
        stack.push({ node, kind: 'list', current: node.body });
        break;
      }
      case 'endlist': {
        const f = top();
        if (f.kind !== 'list') {
          if (f.kind === 'if') throw new TemplateError(`{[end list]} on line ${line} closes {[if]} opened on line ${f.node.line}; expected {[end if]}`, line, col);
          throw new TemplateError(`{[end list]} on line ${line} has no matching {[list]}`, line, col);
        }
        f.node.endLine = line; f.node.endCol = col;
        stack.pop();
        break;
      }
      case 'end': {
        const f = top();
        if (f.kind === 'root') throw new TemplateError(`{[end]} on line ${line} has no matching {[if]} or {[list]}`, line, col);
        f.node.endLine = line; f.node.endCol = col;
        stack.pop();
        break;
      }
      default:
        throw new TemplateError(`Unknown tag {[${t.value}]}`, line, col);
    }
  }

  if (stack.length > 1) {
    const f = top();
    const open = f.kind === 'if' ? '{[if]}' : '{[list]}';
    const close = f.kind === 'if' ? '{[end if]}' : '{[end list]}';
    throw new TemplateError(`${open} on line ${f.node.line} has no matching ${close}`, f.node.line, f.node.col);
  }
  return root;
}

/**
 * Walk every node in an AST (depth-first, in document order).
 * @param {Object} ast
 * @param {(node:Object, parents:Object[]) => void} visit
 */
export function walk(ast, visit, parents = []) {
  visit(ast, parents);
  const next = [...parents, ast];
  if (ast.body) for (const n of ast.body) walk(n, visit, next);
  if (ast.branches) for (const b of ast.branches) for (const n of b.body) walk(n, visit, next);
  if (ast.elseBody) for (const n of ast.elseBody) walk(n, visit, next);
}
