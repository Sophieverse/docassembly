import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../engine/index.js';

const data = { Children: [{ Name: 'Maya' }, { Name: 'Leo' }, { Name: 'Ann' }] };

test('|punc auto-inserts separators when the body has no {[_punc]}', () => {
  const t = 'Kids: {[list Children|punc:"1, 2, and 3"]}{[Name]}{[end list]}.';
  assert.equal(assemble(t, data).text, 'Kids: Maya, Leo, and Ann.');
  assert.equal(assemble(t, { Children: data.Children.slice(0, 2) }).text, 'Kids: Maya and Leo.');
  assert.equal(assemble(t, { Children: data.Children.slice(0, 1) }).text, 'Kids: Maya.');
});

test('|punc with explicit {[_punc]} is not doubled', () => {
  const t = '{[list Children|punc:"1; 2; or 3"]}{[Name]}{[_punc]}{[end list]}';
  assert.equal(assemble(t, data).text, 'Maya; Leo; or Ann');
});

test('list without |punc does not auto-punctuate', () => {
  const t = '{[list Children]}{[Name]} {[end list]}';
  assert.equal(assemble(t, data).text, 'Maya Leo Ann ');
});
