import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textToBlocks, blocksToText, runsToInline, parseInline } from '../engine/docx/blocks.js';
import { buildDocxSync } from '../engine/docx/docxwrite.js';
import { readDocx } from '../engine/docx/docxread.js';

const P = (runs, extra = {}) => ({ type: 'paragraph', runs, style: 'Normal', align: 'left', ...extra });

test('runsToInline: a placeholder split across differently formatted runs comes out as one clean field', () => {
  assert.equal(runsToInline([{ text: '{[Client.' }, { text: 'FullName', bold: true }, { text: ']}' }]), '{[Client.FullName]}');
  assert.equal(runsToInline([{ text: '{[' }, { text: 'Fee', italic: true }, { text: '|currency]}' }]), '{[Fee|currency]}');
  assert.equal(runsToInline([{ text: 'Dear {[' }, { text: 'Client.Salutation', underline: true }, { text: '|default:"Sir"]}:' }]), 'Dear {[Client.Salutation|default:"Sir"]}:');
  // pipes / stars / underscores inside a field are never escaped, even when the field spans runs
  assert.equal(runsToInline([{ text: '{[X|format:"a' }, { text: '*b*', bold: true }, { text: '"]}' }]), '{[X|format:"a*b*"]}');
});

test('runsToInline: the field keeps the formatting of the run it starts in; formatting resumes after it', () => {
  assert.equal(runsToInline([{ text: '{[Client.FullName]}', bold: true }]), '**{[Client.FullName]}**');
  assert.equal(runsToInline([{ text: 'I, ' }, { text: '{[Client.FullName]}', bold: true }, { text: ', declare' }]), 'I, **{[Client.FullName]}**, declare');
  // bold opens mid-field and continues after: no marker inside the field, bold starts after it
  assert.equal(runsToInline([{ text: '{[X' }, { text: ']} rest', bold: true }]), '{[X]}** rest**');
  // bold that covers the start of the field and ends inside it: field is bold, close after it
  assert.equal(runsToInline([{ text: 'a {[X', bold: true }, { text: ']} b' }]), '**a {[X]}** b');
  // an unterminated field runs to the end of the paragraph, raw
  assert.equal(runsToInline([{ text: '{[Client.' }, { text: 'FullName', bold: true }]), '{[Client.FullName');
  // text outside fields is still escaped
  assert.equal(runsToInline([{ text: '{[' }, { text: 'A', bold: true }, { text: ']} *x* a|b' }]), '{[A]} \\*x\\* a\\|b');
});

test('readDocx → text: Word-split placeholders import without markdown markers inside the field', async () => {
  const blocks = [
    P([{ text: '{[Client.' }, { text: 'FullName', bold: true }, { text: ']}' }]),
    P([{ text: '{[' }, { text: 'Fee', italic: true }, { text: '|currency]}' }, { text: ' due' }]),
    P([{ text: 'Signed: ' }, { text: '{[Client.FullName]}', bold: true }]),
  ];
  const { text } = await readDocx(buildDocxSync(blocks));
  assert.equal(text, '{[Client.FullName]}\n{[Fee|currency]} due\nSigned: **{[Client.FullName]}**');
  assert.doesNotMatch(text, /\{\[[^\]]*[*_\\][^\]]*\]\}/, 'no markers or escapes inside any field');
});

test('parseInline / textToBlocks never escape or interpret | * _ inside {[ ]}, including table cells', () => {
  assert.deepEqual(parseInline('{[Fee|currency]} and {[X|format:"a*b*"]}'), [{ text: '{[Fee|currency]} and {[X|format:"a*b*"]}' }]);
  assert.deepEqual(parseInline('**{[Name]}**'), [{ text: '{[Name]}', bold: true }]);
  const blocks = textToBlocks('|Item|Cost|\n|{[Item.Name]}|{[Item.Fee|currency]}|');
  assert.equal(blocks[0].type, 'table');
  assert.equal(blocks[0].rows[1][1][0].runs[0].text, '{[Item.Fee|currency]}');
  assert.equal(blocksToText(blocks), '|Item|Cost|\n|{[Item.Name]}|{[Item.Fee|currency]}|');
  // round trip of a whole-field bold cell and a filter with a pipe outside a field
  const src = '|**{[Item.Name]}**|{[Item.Fee|currency]} \\| note|';
  assert.equal(blocksToText(textToBlocks(src)), src);
});
