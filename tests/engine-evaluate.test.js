import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { render, renderToBlocks, formatValue } from '../engine/evaluate.js';

const R = (src, data, opts) => render(parse(src), data, opts);

test('field substitution and value formatting', () => {
  const r = R('{[Name]} {[Age]} {[Flag]} {[No]} {[D]} {[List]} {[Obj]}', { Name: 'Ann', Age: 42, Flag: true, No: false, D: '2026-03-05', List: ['a', 'b'], Obj: { Name: 'Bob' } });
  assert.equal(r.text, 'Ann 42 Yes No March 5, 2026 a, b Bob');
  assert.deepEqual(r.warnings, []);
  assert.equal(formatValue(new Date(2026, 0, 1)), 'January 1, 2026');
  assert.equal(formatValue(new Date(2026, 0, 1), { dateFormat: 'short' }), '1/1/2026');
  assert.equal(formatValue(true, { yes: 'True', no: 'False' }), 'True');
  assert.equal(formatValue(1.5), '1.5');
  assert.equal(formatValue(null), '');
  assert.equal(formatValue('plain text'), 'plain text');
  assert.equal(formatValue({ a: 1 }), '{"a":1}');
});

test('missing values → "" with a warning listing the path', () => {
  const r = R('Dear {[Client.Name]}, {[Client.Spouse.Name]} {[Nope]} {[Client.Name|default:"x"]}', { Client: { Spouse: {} } });
  assert.equal(r.text, 'Dear ,   x');
  assert.deepEqual(r.warnings, ['Missing value: Client.Name', 'Missing value: Client.Spouse.Name', 'Missing value: Nope']);
  assert.ok(r.trace.missing.has('Client.Name'));
  assert.ok(r.trace.referenced.has('Client.Spouse'));
  assert.equal(R('{[X]}', {}, { missingText: '____' }).text, '____');
  // blank result from a complex expression names the expression
  assert.deepEqual(R('{[A + B]}', {}).warnings, ['Missing value: A', 'Missing value: B']);
  assert.deepEqual(R('{[upper(Q)]}', {}).warnings, ['Missing value: Q']);
  // a default-filled value is not a warning
  assert.deepEqual(R('{[Q|default:"x"]}', {}).warnings, []);
  // _punc after last item is not a warning
  assert.deepEqual(R('{[list L]}{[_item]}{[_punc]}{[end list]}', { L: [1] }).warnings, []);
});

test('if / else if / else nesting', () => {
  const t = '{[if A]}a{[else if B]}b{[elif C]}c{[else]}z{[end if]}';
  assert.equal(R(t, { A: 1 }).text, 'a');
  assert.equal(R(t, { B: 'x' }).text, 'b');
  assert.equal(R(t, { C: true }).text, 'c');
  assert.equal(R(t, {}).text, 'z');
  assert.equal(R(t, { A: '', B: 0, C: [] }).text, 'z');
  const nested = '{[if A]}[{[if B]}AB{[else]}A!B{[end if]}]{[else]}[{[if B]}!AB{[else]}none{[end if]}]{[end if]}';
  assert.equal(R(nested, { A: true, B: true }).text, '[AB]');
  assert.equal(R(nested, { A: true, B: false }).text, '[A!B]');
  assert.equal(R(nested, { A: false, B: true }).text, '[!AB]');
  assert.equal(R(nested, {}).text, '[none]');
  assert.equal(R('{[if not IsMarried]}single{[end if]}', {}).text, 'single');
  assert.equal(R('{[if Count > 2 and Name = "x"]}yes{[end if]}', { Count: 3, Name: 'x' }).text, 'yes');
});

test('if conditions do not produce missing-value warnings', () => {
  const r = R('{[if IsMarried]}m{[end if]}', {});
  assert.equal(r.text, '');
  assert.deepEqual(r.warnings, []);
  assert.ok(r.trace.referenced.has('IsMarried'));
  assert.ok(r.trace.relevant.has('IsMarried'));
});

test('lists with _index, _first, _last, _count, _punc, _item', () => {
  const t = '{[list Names]}{[_index]}/{[_index0]}:{[_item]}{[if _first]}(first){[end if]}{[if _last]}(last){[end if]}{[_punc]}{[end list]} of {[count(Names)]}';
  assert.equal(R(t, { Names: ['A', 'B', 'C'] }).text, '1/0:A(first), 2/1:B, and 3/2:C(last) of 3');
  assert.equal(R('{[list N]}{[_item]}{[_punc]}{[end list]}', { N: ['A', 'B'] }).text, 'A and B');
  assert.equal(R('{[list N]}{[_item]}{[_punc]}{[end list]}', { N: ['A'] }).text, 'A');
  assert.equal(R('{[list N]}{[_item]}{[_punc]}{[end list]}', { N: [] }).text, '');
  assert.equal(R('{[list N]}{[_item]}{[_punc]}{[end list]}', {}).text, '');
  assert.equal(R('{[list N]}{[_item]}{[_count]}{[end list]}', { N: 'solo' }).text, 'solo1');
});

test('item scope shadows outer scope; outer still reachable; "as" alias', () => {
  const data = { Name: 'Outer', Kids: [{ Name: 'K1' }, { Name: 'K2', Age: 3 }] };
  assert.equal(R('{[list Kids]}{[Name]}{[end list]}', data).text, 'K1K2');
  assert.equal(R('{[list Kids as kid]}{[kid.Name]}-{[Name]}{[end list]}', data).text, 'K1-K1K2-K2');
  const r = R('{[list Kids]}{[Name]}:{[Age]};{[end list]}', data);
  assert.equal(r.text, 'K1:;K2:3;');
  assert.deepEqual(r.warnings, ['Missing value: Kids[].Age']);
  assert.ok(r.trace.referenced.has('Kids[].Name'));
  assert.ok(r.trace.referenced.has('Kids'));
});

test('nested lists with _punc at each level', () => {
  const data = { Families: [{ Name: 'Smith', Kids: ['A', 'B'] }, { Name: 'Jones', Kids: ['C', 'D', 'E'] }] };
  const t = '{[list Families]}{[Name]}: {[list Kids]}{[_item]}{[_punc]}{[end list]}{[_punc]}{[end list]}';
  const r = R(t, data);
  assert.equal(r.text, 'Smith: A and B and Jones: C, D, and E');
  assert.ok(r.trace.referenced.has('Families[].Kids'));
  // nested list of objects
  const d2 = { Trusts: [{ Name: 'T1', Beneficiaries: [{ Name: 'B1', Share: 50 }, { Name: 'B2', Share: 50 }] }] };
  const t2 = '{[list Trusts]}{[Name]}: {[list Beneficiaries]}{[Name]} ({[Share]}%){[_punc]}{[end list]}{[end list]}';
  const r2 = R(t2, d2);
  assert.equal(r2.text, 'T1: B1 (50%) and B2 (50%)');
  assert.ok(r2.trace.referenced.has('Trusts[].Beneficiaries[].Name'));
  assert.ok(r2.trace.referenced.has('Trusts[].Beneficiaries[].Share'));
});

test('list with filter expression and punc-by-example', () => {
  const data = { Children: [{ Name: 'A', Age: 5 }, { Name: 'B', Age: 20 }, { Name: 'C', Age: 2 }] };
  assert.equal(R('{[list Children|filter: Age < 18]}{[Name]}{[_punc]}{[end list]}', data).text, 'A and C');
  assert.equal(R('{[list Children|punc:"1; 2; or 3."]}{[Name]}{[_punc]}{[end list]}', data).text, 'A; B; or C.');
  assert.equal(R('{[list Children|filter: Age < 18|punc:"1 and 2."]}{[Name]}{[_punc]}{[end list]}', data).text, 'A and C.');
  assert.equal(R('{[list sort(Children, "Age")]}{[Name]}{[end list]}', data).text, 'CAB');
  assert.equal(R('{[list Children|sort: -Age]}{[Name]}{[end list]}', data).text, 'BAC');
  assert.equal(R('{[Children|filter: Age < 18|map: Name|punc:"1, 2 and 3"]}', data).text, 'A and C');
});

test('whitespace: standalone tag lines vanish; conditional paragraphs leave no blank lines', () => {
  const t = 'Para 1\n{[if Married]}\nSpouse para\n{[end if]}\nPara 3\n{[list Kids]}\n- {[_item]}\n{[end list]}\nEnd\n{[# comment]}\n';
  assert.equal(R(t, { Married: false }).text, 'Para 1\nPara 3\nEnd\n');
  assert.equal(R(t, { Married: true, Kids: ['a', 'b'] }).text, 'Para 1\nSpouse para\nPara 3\n- a\n- b\nEnd\n');
  const inline = 'He is {[if Married]}married{[else]}single{[end if]}.';
  assert.equal(R(inline, { Married: true }).text, 'He is married.');
});

test('booleans, numbers, dates, arrays rendering', () => {
  assert.equal(R('{[B]}', { B: false }).text, 'No');
  assert.equal(R('{[N]}', { N: 0 }).text, '0');
  assert.equal(R('{[D|format:"short"]}', { D: '2026-03-05' }).text, '3/5/2026');
  assert.equal(R('{[D]}', { D: new Date(2026, 2, 5) }).text, 'March 5, 2026');
  assert.equal(R('{[L]}', { L: [1, 'b', true] }).text, '1, b, Yes');
  assert.equal(R('{[Fee|currency]} {[Fee|dollars]}', { Fee: 1500 }).text, '$1,500.00 One Thousand Five Hundred and 00/100 Dollars');
});

test('errors in expressions become warnings (or throw in strict mode)', () => {
  const r = R('{[nosuch(1)]}', {});
  assert.equal(r.text, '');
  assert.match(r.warnings[0], /Unknown function "nosuch"/);
  assert.throws(() => R('{[nosuch(1)]}', {}, { strict: true }));
});

test('custom functions via options', () => {
  const r = R('{[Name|wrap]}', { Name: 'x' }, { functions: { wrap: (s) => `[${s}]` } });
  assert.equal(r.text, '[x]');
});

test('renderToBlocks splits into lines', () => {
  const r = renderToBlocks(parse('# Title\n\nHello {[Name]}\r\n---'), { Name: 'Ann' });
  assert.deepEqual(r.lines, ['# Title', '', 'Hello Ann', '---']);
  assert.equal(r.text, '# Title\n\nHello Ann\r\n---');
});

test('trace.relevant includes condition variables of untaken branches and all rendered fields', () => {
  const r = R('{[if A]}{[X]}{[else]}{[Y]}{[end if]}', { A: false, Y: 1 });
  assert.deepEqual([...r.trace.relevant].sort(), ['A', 'Y']);
});
