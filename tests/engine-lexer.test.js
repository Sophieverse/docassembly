import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, TemplateError, normalizeSmartQuotes } from '../engine/lexer.js';

test('tokenize splits text and fields with line/col', () => {
  const toks = tokenize('Hello {[Name]},\nyou owe {[ Fee|currency ]}.');
  assert.deepEqual(toks.map((t) => [t.type, t.value, t.line, t.col]), [
    ['text', 'Hello ', 1, 1],
    ['field', 'Name', 1, 7],
    ['text', ',\nyou owe ', 1, 15],
    ['field', 'Fee|currency', 2, 9],
    ['text', '.', 2, 27],
  ]);
});

test('empty and text-only templates', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize('plain'), [{ type: 'text', value: 'plain', line: 1, col: 1 }]);
});

test('adjacent fields and field at start/end', () => {
  const toks = tokenize('{[A]}{[B]}');
  assert.deepEqual(toks.map((t) => t.value), ['A', 'B']);
  assert.equal(toks[1].col, 6);
});

test('unterminated field throws TemplateError with position', () => {
  assert.throws(() => tokenize('line one\nHello {[Name'), (e) => e instanceof TemplateError && e.line === 2 && e.col === 7 && /Unterminated/.test(e.message));
  assert.throws(() => tokenize('{[A} text {[B]}'), (e) => e instanceof TemplateError && e.line === 1 && e.col === 1);
});

test('smart quotes are normalized inside fields only', () => {
  const toks = tokenize('“quoted” {[Name|default:“N/A”]} {[X|format:‘long’]}');
  assert.equal(toks[0].value, '“quoted” ');
  assert.equal(toks[1].value, 'Name|default:"N/A"');
  assert.equal(toks[3].value, "X|format:'long'");
  assert.equal(normalizeSmartQuotes('a – b'), 'a - b');
});

test('braces that are not fields are literal', () => {
  const toks = tokenize('{ not a field } [also] {[Real]}');
  assert.equal(toks[0].value, '{ not a field } [also] ');
  assert.equal(toks[1].value, 'Real');
});

test('CRLF line counting', () => {
  const toks = tokenize('a\r\nb\r\n{[X]}');
  assert.equal(toks[1].line, 3);
});
