import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { textToBlocks, blocksToText } from '../engine/docx/blocks.js';
import { buildDocx, buildDocxSync, buildDocumentXml } from '../engine/docx/docxwrite.js';
import { readDocx } from '../engine/docx/docxread.js';
import { readZip, readZipText } from '../engine/docx/zipread.js';
import { crc32 } from '../engine/docx/zipwrite.js';

const OUT = '/private/tmp/claude-501/-Users-melod/3d0f23c6-a481-4b3b-a0b2-43cc231b3f85/scratchpad/docx-test-out';
mkdirSync(OUT, { recursive: true });

const TEXT = [
  '>title Last Will & <Testament>',
  '# Article I',
  'I, **{[Client.FullName]}**, of {[Client.City]}, declare this to be my *Will*.',
  '',
  '\tIndented paragraph.',
  '>justify Justified paragraph with __underline__ text.',
  '>center Centered',
  '>right Right',
  '1. First',
  '2. Second',
  '  a. Sub',
  '- Bullet',
  '  - Nested',
  '|Beneficiary|Share|',
  '|{[B.Name]}|{[B.Share]}%|',
  '---',
  '## Article II',
  '1. Restarted list',
].join('\n');

test('crc32 vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('buildDocx → readDocx round trip (compressed)', async () => {
  const blocks = textToBlocks(TEXT);
  const bytes = await buildDocx(blocks, { title: 'Will', font: 'Garamond', fontSize: 11, margins: { top: 1, right: 1.25, bottom: 1, left: 1.25 }, lineSpacing: 1.5 });
  assert.ok(bytes instanceof Uint8Array);
  writeFileSync(OUT + '/roundtrip.docx', bytes);
  const zip = readZip(bytes);
  assert.ok(zip.has('docProps/core.xml'));
  if (typeof CompressionStream === 'function') assert.equal(zip.get('word/document.xml').method, 8, 'deflated');
  assert.match(await readZipText(bytes, 'docProps/core.xml'), /<dc:title>Will<\/dc:title>/);
  const styles = await readZipText(bytes, 'word/styles.xml');
  assert.match(styles, /w:ascii="Garamond"/);
  assert.match(styles, /<w:sz w:val="22"\/>/);
  assert.match(styles, /w:line="360"/);
  assert.match(await readZipText(bytes, 'word/document.xml'), /w:left="1800"/);

  const { text, blocks: back } = await readDocx(bytes);
  assert.deepEqual(back, blocks);
  assert.equal(text, blocksToText(blocks));
  assert.equal(text, TEXT);
});

test('buildDocxSync stores uncompressed and reads back', async () => {
  const blocks = textToBlocks('Hello **world**');
  const bytes = buildDocxSync(blocks);
  assert.equal(readZip(bytes).get('word/document.xml').method, 0);
  const { blocks: back } = await readDocx(bytes);
  assert.deepEqual(back, blocks);
});

test('numbered lists restart with a fresh w:num per group', async () => {
  const blocks = textToBlocks(['1. a', '2. b', '', '3. c', 'Break', '1. d', '- bullet', '1. e'].join('\n'));
  const xml = buildDocumentXml(blocks);
  const ids = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['2', '2', '2', '3', '1', '3'], 'blank lines and bullets do not break a numbered group; a text paragraph does');
  const bytes = await buildDocx(blocks);
  const num = await readZipText(bytes, 'word/numbering.xml');
  for (const id of ['2', '3']) assert.match(num, new RegExp(`<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>`));
});

test('accepts the legacy spike block shape', () => {
  const xml = buildDocumentXml([
    { type: 'paragraph', list: 'number', level: 1, align: 'both', runs: [{ text: 'x' }] },
    { type: 'pageBreak' },
  ]);
  assert.match(xml, /<w:ilvl w:val="1"\/><w:numId w:val="2"\/>/);
  assert.match(xml, /<w:jc w:val="both"\/>/);
  assert.match(xml, /<w:br w:type="page"\/>/);
});

test('XML escaping of special characters', async () => {
  const blocks = textToBlocks('Fish & Chips <b> "quoted"');
  const { blocks: back } = await readDocx(await buildDocx(blocks));
  assert.equal(back[0].runs[0].text, 'Fish & Chips <b> "quoted"');
});
