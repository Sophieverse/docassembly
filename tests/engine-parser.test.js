import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, walk, classifyTag } from '../engine/parser.js';
import { TemplateError } from '../engine/lexer.js';

const types = (ast) => ast.body.map((n) => n.type);

test('text and field nodes', () => {
  const ast = parse('Hello {[Name]}!');
  assert.equal(ast.type, 'root');
  assert.deepEqual(types(ast), ['text', 'field', 'text']);
  assert.equal(ast.body[1].src, 'Name');
  assert.equal(ast.body[1].expr.type, 'ident');
  assert.deepEqual([ast.body[1].line, ast.body[1].col], [1, 7]);
});

test('comment nodes', () => {
  const ast = parse('A{[# note to drafter]}B');
  assert.deepEqual(types(ast), ['text', 'comment', 'text']);
  assert.equal(ast.body[1].value, 'note to drafter');
});

test('if / else if / elseif / elif / else / end if / endif — case-insensitive', () => {
  const ast = parse('{[IF a]}1{[Else If b]}2{[ELSEIF c]}3{[elif d]}4{[ELSE]}5{[End If]}');
  const n = ast.body[0];
  assert.equal(n.type, 'if');
  assert.equal(n.branches.length, 4);
  assert.deepEqual(n.branches.map((b) => b.src), ['a', 'b', 'c', 'd']);
  assert.deepEqual(n.branches.map((b) => b.body[0].value), ['1', '2', '3', '4']);
  assert.equal(n.elseBody[0].value, '5');
  assert.equal(parse('{[if a]}x{[endif]}').body[0].type, 'if');
  assert.equal(parse('{[if a]}x{[end]}').body[0].type, 'if');
});

test('nested if inside else, records line/col and endLine', () => {
  const src = 'A\n{[if a]}\nB\n{[else]}\n{[if b]}\nC\n{[end if]}\n{[end if]}\nD';
  const ast = parse(src);
  const outer = ast.body[1];
  assert.equal(outer.line, 2);
  assert.equal(outer.endLine, 8);
  const inner = outer.elseBody[0];
  assert.equal(inner.type, 'if');
  assert.equal(inner.line, 5);
  assert.equal(inner.endLine, 7);
});

test('list / repeat / foreach with end variants and "as" alias', () => {
  for (const [open, close] of [['list', 'end list'], ['LIST', 'endlist'], ['repeat', 'end repeat'], ['foreach', 'endforeach'], ['for each', 'end for each'], ['list', 'end']]) {
    const ast = parse(`{[${open} Children]}{[Name]}{[${close}]}`);
    assert.equal(ast.body[0].type, 'list', open);
    assert.equal(ast.body[0].src, 'Children');
    assert.equal(ast.body[0].body[0].type, 'field');
  }
  const ast = parse('{[list Children as child]}{[child.Name]}{[end list]}');
  assert.equal(ast.body[0].itemName, 'child');
  assert.equal(ast.body[0].src, 'Children');
  const f = parse('{[list Children|filter: Age < 18]}x{[end list]}');
  assert.equal(f.body[0].expr.type, 'filter');
});

test('unbalanced blocks give helpful errors with line/col', () => {
  assert.throws(() => parse('x\n\n{[if a]}\nbody'), (e) => e instanceof TemplateError && /\{\[if\]\} on line 3 has no matching \{\[end if\]\}/.test(e.message) && e.line === 3);
  assert.throws(() => parse('{[list L]}\n{[end if]}'), (e) => /\{\[end if\]\} on line 2 closes \{\[list\]\} opened on line 1/.test(e.message));
  assert.throws(() => parse('{[end if]}'), /has no matching \{\[if\]\}/);
  assert.throws(() => parse('{[end list]}'), /has no matching \{\[list\]\}/);
  assert.throws(() => parse('{[else]}'), /not inside an \{\[if\]\}/);
  assert.throws(() => parse('{[if a]}{[else]}{[else]}{[end if]}'), /Duplicate \{\[else\]\}/);
  assert.throws(() => parse('{[if a]}{[else]}{[else if b]}{[end if]}'), /comes after \{\[else\]\}/);
  assert.throws(() => parse('{[list L]}x'), /\{\[list\]\} on line 1 has no matching \{\[end list\]\}/);
  assert.throws(() => parse('{[if]}x{[end if]}'), /needs a condition/);
  assert.throws(() => parse('{[list]}x{[end list]}'), /needs a list expression/);
  assert.equal(parse('{[List]}').body[0].type, 'field'); // capitalised bare keyword = variable
  assert.throws(() => parse('a\n{[if 1 +]}x{[end if]}'), (e) => e instanceof TemplateError && e.line === 2 && /Bad \{\[if\]\} condition/.test(e.message));
  assert.throws(() => parse('{[Name|]}'), (e) => e instanceof TemplateError && /Bad field/.test(e.message));
});

test('standalone structural tag lines are removed; inline tags keep text', () => {
  const ast = parse('Para 1\n{[if a]}\nPara 2\n{[end if]}\nPara 3');
  assert.equal(ast.body[0].value, 'Para 1\n');
  assert.equal(ast.body[1].branches[0].body[0].value, 'Para 2\n');
  assert.equal(ast.body[2].value, 'Para 3');
  const inline = parse('Hello {[if a]}there{[end if]}!');
  assert.equal(inline.body[0].value, 'Hello ');
  assert.equal(inline.body[2].value, '!');
  // indented tags
  const ind = parse('A\n   {[if a]}   \nB\n\t{[end if]}\nC');
  assert.equal(ind.body[0].value, 'A\n');
  assert.equal(ind.body[2].value, 'C');
  // comment alone on a line disappears entirely
  const c = parse('A\n{[# hidden]}\nB');
  assert.equal(c.body.map((n) => n.type === 'text' ? n.value : '').join(''), 'A\nB');
  // value fields on their own line are NOT stripped
  const v = parse('A\n{[Name]}\nB');
  assert.equal(v.body[0].value, 'A\n');
  assert.equal(v.body[2].value, '\nB');
  // CRLF
  const crlf = parse('A\r\n{[if a]}\r\nB\r\n{[end if]}\r\nC');
  assert.equal(crlf.body[0].value, 'A\r\n');
  assert.equal(crlf.body[2].value, 'C');
  // consecutive standalone end tags each vanish
  const two = parse('T\n\n{[if a]}\nX\n{[end if]}\n{[end if]}\n\nU'.replace('{[if a]}', '{[if a]}\n{[if b]}'));
  assert.equal(two.body.map((n) => (n.type === 'text' ? n.value : '')).join(''), 'T\n\n\nU');
  // tag on first line, at EOF
  const edge = parse('{[if a]}\nB\n{[end if]}');
  assert.equal(edge.body[0].branches[0].body[0].value, 'B\n');
  assert.equal(edge.body.length, 1);
});

test('classifyTag', () => {
  assert.equal(classifyTag('end   if').kind, 'endif');
  assert.equal(classifyTag('ENDLIST').kind, 'endlist');
  assert.equal(classifyTag('else if x').kind, 'elseif');
  assert.equal(classifyTag('elsewhere').kind, 'field');
  assert.equal(classifyTag('iffy').kind, 'field');
  assert.equal(classifyTag('listing').kind, 'field');
  assert.equal(classifyTag('list Children as kid').itemName, 'kid');
  assert.equal(classifyTag('# c').kind, 'comment');
});

test('walk visits all nodes in document order', () => {
  const ast = parse('{[A]}{[if x]}{[B]}{[else]}{[C]}{[end if]}{[list L]}{[D]}{[end list]}');
  const seen = [];
  walk(ast, (n) => { if (n.type === 'field') seen.push(n.src); });
  assert.deepEqual(seen, ['A', 'B', 'C', 'D']);
});
