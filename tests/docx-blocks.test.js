import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textToBlocks, blocksToText, parseInline } from '../engine/docx/blocks.js';

const SAMPLE = [
  '>title Engagement Letter',
  '# Section 1',
  '## Sub **1.1**',
  '### Deep',
  '',
  'Dear {[Client.FullName]},',
  'This is **bold**, *italic*, __underline__ and **bold *nested italic* bold**.',
  '\tIndented one tab with {[Fee|currency]}.',
  '>center Centered line',
  '>right Right line',
  '>justify Justified line',
  '1. First item',
  '2. Second item',
  '  a. Sub item',
  '  b. Sub item two',
  '3. Third item',
  '- Bullet one',
  '  - Nested bullet',
  '- Bullet two',
  '|Name|Amount|',
  '|---|---|',
  '|{[Item.Name]}|**{[Item.Amount|currency]}**|',
  '|a|b|',
  '---',
  'After break.',
].join('\n');

test('textToBlocks: structure', () => {
  const b = textToBlocks(SAMPLE);
  assert.equal(b[0].style, 'Title');
  assert.equal(b[0].runs[0].text, 'Engagement Letter');
  assert.equal(b[1].style, 'Heading1');
  assert.equal(b[2].style, 'Heading2');
  assert.deepEqual(b[2].runs, [{ text: 'Sub ' }, { text: '1.1', bold: true }]);
  assert.equal(b[3].style, 'Heading3');
  assert.deepEqual(b[4], { type: 'paragraph', runs: [], style: 'Normal', align: 'left' });
  assert.equal(b[5].runs[0].text, 'Dear {[Client.FullName]},');
  assert.deepEqual(b[6].runs, [
    { text: 'This is ' }, { text: 'bold', bold: true }, { text: ', ' }, { text: 'italic', italic: true }, { text: ', ' },
    { text: 'underline', underline: true }, { text: ' and ' }, { text: 'bold ', bold: true }, { text: 'nested italic', bold: true, italic: true }, { text: ' bold', bold: true }, { text: '.' },
  ]);
  assert.equal(b[7].indent, 1);
  assert.equal(b[7].runs[0].text, 'Indented one tab with {[Fee|currency]}.');
  assert.equal(b[8].align, 'center'); assert.equal(b[9].align, 'right'); assert.equal(b[10].align, 'justify');
  assert.deepEqual(b[11].numbering, { kind: 'decimal', level: 0 });
  assert.deepEqual(b[13].numbering, { kind: 'decimal', level: 1 });
  assert.equal(b[13].runs[0].text, 'Sub item');
  assert.deepEqual(b[16].numbering, { kind: 'bullet', level: 0 });
  assert.deepEqual(b[17].numbering, { kind: 'bullet', level: 1 });
  const t = b[19];
  assert.equal(t.type, 'table');
  assert.equal(t.rows.length, 3, 'separator row ignored');
  assert.equal(t.rows[1][0][0].runs[0].text, '{[Item.Name]}');
  assert.deepEqual(t.rows[1][1][0].runs, [{ text: '{[Item.Amount|currency]}', bold: true }]);
  assert.equal(b[20].type, 'pagebreak');
  assert.equal(b[21].runs[0].text, 'After break.');
});

test('inline: unmatched markers are literal; fields are verbatim', () => {
  assert.deepEqual(parseInline('5 * 3 = 15'), [{ text: '5 * 3 = 15' }]);
  assert.deepEqual(parseInline('a ** b'), [{ text: 'a ** b' }]);
  assert.deepEqual(parseInline('__x'), [{ text: '__x' }]);
  assert.deepEqual(parseInline('{[a|default:"**"]} **b**'), [{ text: '{[a|default:"**"]} ' }, { text: 'b', bold: true }]);
  assert.deepEqual(parseInline('\\*literal\\*'), [{ text: '*literal*' }]);
  assert.deepEqual(parseInline('***both***'), [{ text: 'both', bold: true, italic: true }]);
});

test('blocksToText: inverse of textToBlocks on the rich sample', () => {
  const blocks = textToBlocks(SAMPLE);
  const text = blocksToText(blocks);
  const expected = SAMPLE.replace('|---|---|\n', '');
  assert.equal(text, expected);
  assert.deepEqual(textToBlocks(text), blocks);
});

test('blocksToText: whole-paragraph bold, escaping, list restarts', () => {
  const blocks = [
    { type: 'paragraph', runs: [{ text: 'ALL BOLD', bold: true }], style: 'Normal', align: 'center' },
    { type: 'paragraph', runs: [{ text: '1. not a list' }], style: 'Normal', align: 'left' },
    { type: 'paragraph', runs: [{ text: '# not a heading' }], style: 'Normal', align: 'left' },
    { type: 'paragraph', runs: [{ text: 'a * b' }], style: 'Normal', align: 'left' },
    { type: 'paragraph', runs: [{ text: 'x' }], style: 'Normal', align: 'left', numbering: { kind: 'decimal', level: 0 } },
    { type: 'paragraph', runs: [{ text: 'y' }], style: 'Normal', align: 'left', numbering: { kind: 'decimal', level: 0 } },
    { type: 'paragraph', runs: [{ text: 'break' }], style: 'Normal', align: 'left' },
    { type: 'paragraph', runs: [{ text: 'z' }], style: 'Normal', align: 'left', numbering: { kind: 'decimal', level: 0 } },
  ];
  const text = blocksToText(blocks);
  assert.equal(text, ['>center **ALL BOLD**', '\\1. not a list', '\\# not a heading', 'a \\* b', '1. x', '2. y', 'break', '1. z'].join('\n'));
  assert.deepEqual(textToBlocks(text), blocks);
});

test('CRLF input and trailing newline', () => {
  assert.equal(textToBlocks('a\r\nb\r\n').length, 2);
});
