// Regression tests for docs/code-review-2.md findings 1, 2, 4, 5, 6, 7, 8, 9 (3 lives in engine-review2-zip.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { analyze, collectAnnotations, patternProblem, compilePattern } from '../engine/analyze.js';
import { createModel, applyAnnotations, validate, coerce } from '../engine/model.js';
import { compile, questionnaire } from '../engine/index.js';
import { runsToInline, parseInline } from '../engine/docx/blocks.js';
import { escapeXml } from '../engine/docx/docxwrite.js';

const model = (tpl, edits = {}) => {
  const m = createModel(analyze(parse(tpl)));
  for (const [path, patch] of Object.entries(edits)) Object.assign(m.variables[path], patch);
  return m;
};
const msgs = (errs) => Object.fromEntries(errs.map((e) => [e.path, e.message]));

test('#1 runsToInline: run-edge whitespace stays outside the markers so import never yields literal asterisks', () => {
  assert.equal(runsToInline([{ text: 'Hello' }, { text: ' World', bold: true }]), 'Hello **World**');
  assert.equal(runsToInline([{ text: 'bold ', bold: true }, { text: 'italic ', italic: true }, { text: 'plain' }]), '**bold** *italic* plain');
  assert.equal(runsToInline([{ text: 'a', bold: true }, { text: '  ', italic: true }, { text: 'b', bold: true }]), '**a  b**');
  assert.equal(runsToInline([{ text: 'x', underline: true }, { text: ' ' }]), '__x__ ');
  // an all-whitespace formatted run changes nothing
  assert.equal(runsToInline([{ text: 'x' }, { text: '   ', bold: true }, { text: 'y' }]), 'x   y');
  // what comes out re-parses as formatting, not text with stars in it
  assert.deepEqual(parseInline(runsToInline([{ text: 'Hello' }, { text: ' World', bold: true }])), [{ text: 'Hello ' }, { text: 'World', bold: true }]);
});

test('#2 ReDoS: ^(a+)+$ is refused at annotation time and validate() returns fast and reports the pattern as invalid', () => {
  const m = model('{[Code]}', { Code: { pattern: '^(a+)+$' } });
  const t0 = performance.now();
  const errs = validate(m, { Code: 'a'.repeat(39) + '!' });
  const ms = performance.now() - t0;
  assert.ok(ms < 50, `validate took ${ms.toFixed(1)} ms`);
  assert.deepEqual(errs, [{ path: 'Code', message: 'Code: invalid pattern /^(a+)+$/' }]);
  // annotation-time lint, same shapes
  const { annotationErrors } = collectAnnotations(parse('{[# @pattern Code: ^(a+)+$]}{[Code]}'));
  assert.equal(annotationErrors.length, 1);
  assert.match(annotationErrors[0].message, /@pattern Code: .*nested quantifiers/);
  for (const bad of ['(\\d*)*', '^(x+){2,}$', '((ab)+)*', '(a?)+', '(a+|b)*', '^(\\w+\\s*)+$']) assert.match(patternProblem(bad) || '', /nested quantifiers/, bad);
  // ordinary patterns still work, `(…)?` on a quantified group is fine, character classes are not groups
  for (const ok of ['^\\d{5}(-\\d{4})?$', '^[A-Z][a-z]+$', '^(\\d+\\.)*\\d+$', '^(\\d{1,3}\\.){3}\\d{1,3}$', '[(+*]+', '^(abc)+$', '^(\\d+\\.){2}$', '(a|b)+']) assert.equal(patternProblem(ok), null, ok);
  const m2 = model('{[Zip]}', { Zip: { pattern: '^\\d{5}(-\\d{4})?$' } });
  assert.deepEqual(validate(m2, { Zip: '94704' }), []);
  assert.match(msgs(validate(m2, { Zip: 'abc' }))['Zip'], /must match pattern/);
});

test('#2 pattern length cap and bounded input; compiled patterns are memoised', () => {
  assert.match(patternProblem('a'.repeat(257)) || '', /longer than 256/);
  assert.equal(patternProblem('a'.repeat(256)), null);
  assert.equal(compilePattern('^\\w+$'), compilePattern('^\\w+$'));
  assert.ok(compilePattern('(') instanceof Error);
  // only the first 4096 characters are tested: a value that fails past that is not chased
  const m = model('{[Notes]}', { Notes: { pattern: '^[a-z]*$' } });
  const t0 = performance.now();
  validate(m, { Notes: 'a'.repeat(5_000_000) + '!' });
  assert.ok(performance.now() - t0 < 50);
  assert.deepEqual(validate(m, { Notes: 'a'.repeat(4096) + '!!!' }), []);
});

test('#4 multiselect validation and @default accept {value,label} option objects', () => {
  const opts = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];
  const m = model('{[Picks]}', { Picks: { type: 'multiselect', options: opts } });
  assert.deepEqual(validate(m, { Picks: ['a', 'b'] }), []);
  assert.deepEqual(validate(m, { Picks: ['A'] }), [], 'option match is case-insensitive like selection');
  assert.match(msgs(validate(m, { Picks: ['c'] }))['Picks'], /"c" is not an option/);
  // @default against object options
  const m2 = model('{[Picks]}', { Picks: { type: 'multiselect', options: opts } });
  const errors = [];
  applyAnnotations(m2, new Map([['Picks', { default: 'a | b' }]]), errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(m2.variables.Picks.default, ['a', 'b']);
  applyAnnotations(m2, new Map([['Picks', { default: 'a | zz' }]]), errors);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /"zz" is not one of the options/);
});

test('#5 escapeXml strips U+FFFE / U+FFFF and replaces lone surrogates with U+FFFD', () => {
  assert.equal(escapeXml('a￾b￿c'), 'abc');
  assert.equal(escapeXml('x\uD800y'), 'x�y');
  assert.equal(escapeXml('x\uDC00y'), 'x�y');
  assert.equal(escapeXml('😀'), '😀', 'a proper pair is kept');
  assert.equal(escapeXml('\uD83D😀\uDE00'), '�😀�');
  assert.equal(escapeXml('<&">'), '&lt;&amp;&quot;&gt;');
});

test('#6 @validate uses template truthiness (whitespace string / 0 / empty array are not valid)', () => {
  const m = model('{[X]}', { X: { validate: 'value' } });
  assert.deepEqual(validate(m, { X: 'ok' }), []);
  const w = model('{[X]}', { X: { validate: '"   "' } });
  assert.match(msgs(validate(w, { X: 'anything' }))['X'], /is not valid/);
  const z = model('{[X]}', { X: { validate: '0' } });
  assert.match(msgs(validate(z, { X: 'anything' }))['X'], /is not valid/);
  const e = model('{[X]}', { X: { validate: '[]' } });
  assert.match(msgs(validate(e, { X: 'anything' }))['X'] || '', /is not valid|bad validation rule/);
});

test('#7 Infinity is not a number / currency answer', () => {
  assert.equal(coerce('Infinity', 'number'), 'Infinity');
  assert.equal(coerce('-Infinity', 'currency'), '-Infinity');
  assert.equal(coerce(Infinity, 'number'), Infinity, 'coerce leaves an already-numeric value for validate to flag');
  assert.equal(coerce('1,500', 'number'), 1500);
  const m = model('{[N|number]} {[Fee|currency]}');
  const e = msgs(validate(m, { N: Infinity, Fee: 'Infinity' }));
  assert.match(e['N'], /must be a number/);
  assert.match(e['Fee'], /must be a number/);
  assert.deepEqual(validate(m, { N: 3, Fee: '$2,500.50' }), []);
  // @default Infinity is rejected
  const errors = [];
  applyAnnotations(model('{[N|number]}'), new Map([['N', { default: 'Infinity' }]]), errors);
  assert.match(errors[0].message, /expected a number/);
});

test('#8 unsafe path segments are a TemplateError in compile().errors, not a variable', () => {
  for (const src of ['{[Client.constructor]}', '{[Client.__proto__.x]}', '{[if Client.prototype.x]}y{[end if]}', '{[list Items]}{[constructor]}{[end list]}']) {
    const c = compile(src);
    assert.equal(c.ast, null, src);
    assert.equal(c.errors.length, 1, src);
    assert.match(c.errors[0].message, /not a valid variable name/, src);
    assert.equal(c.errors[0].line, 1, src);
  }
  assert.deepEqual(compile('{[Client.Constructed]} {[Prototypes]}').errors, [], 'only the exact reserved words are refused');
});

test('#9 a concrete-index reference before the list block still orders the list before its item field', () => {
  const src = 'First trust: {[Trusts[0].Name]}\n{[list Trusts]}{[Name]}{[end list]}';
  const a = analyze(parse(src));
  const keys = [...a.variables.keys()];
  assert.ok(keys.indexOf('Trusts') < keys.indexOf('Trusts[].Name'), keys.join(','));
  assert.equal(a.variables.get('Trusts').inferredType, 'list');
  const m = createModel(a);
  assert.ok(m.order.indexOf('Trusts') < m.order.indexOf('Trusts[].Name'));
  const q = questionnaire(parse(src), { Trusts: [{}] }, m).map((x) => x.path);
  assert.ok(q.indexOf('Trusts') < q.indexOf('Trusts[].Name'), q.join(','));
  // object parents keep following their first field (unchanged discovery order)
  assert.deepEqual([...analyze(parse('{[Client.Name]}')).variables.keys()], ['Client.Name', 'Client']);
});
