// QA: regressions for docs/code-review-1.md "## engine/docx" plus bugs found during DOCX QA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textToBlocks, blocksToText, parseInline } from '../engine/docx/blocks.js';
import { parseXml, unescapeXml, readDocx } from '../engine/docx/docxread.js';
import { readZip } from '../engine/docx/zipread.js';
import { writeZip, writeZipAsync } from '../engine/docx/zipwrite.js';
import { buildDocx } from '../engine/docx/docxwrite.js';

const withTimeout = (fn, ms, label) => Promise.race([Promise.resolve().then(fn), new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: timed out after ${ms}ms (infinite loop?)`)), ms).unref())]);

test('review HIGH: parseXml terminates on unterminated comment / PI / CDATA / doctype / tag', async () => {
  const cases = ['<a><!-- never closed', '<a><?pi never closed', '<a><![CDATA[never closed', '<a><!DOCTYPE never closed', '<a><b attr="never closed', '<a><b', '<a>text<', '<!--', '<?', '<!', '<![CDATA[', '<'];
  for (const xml of cases) {
    const root = await withTimeout(() => parseXml(xml), 1000, JSON.stringify(xml));
    assert.ok(root && root.name === '#root', xml);
  }
  // and content before the broken construct is still parsed
  const r = parseXml('<a><b>kept</b><!-- broken');
  assert.equal(r.children[0].children[0].children[0].text, 'kept');
  assert.equal(parseXml('<a><![CDATA[x]]></a>').children[0].children[0].text, 'x');
});

test('review LOW: unescapeXml never throws on out-of-range or huge numeric entities', () => {
  assert.equal(unescapeXml('&#x110000;'), '&#x110000;');
  assert.equal(unescapeXml('&#99999999999;'), '&#99999999999;');
  assert.equal(unescapeXml('&#xFFFFFFFFFF;'), '&#xFFFFFFFFFF;');
  assert.equal(unescapeXml('&#65;&#x42;&amp;&unknown;&#xD83C;'), 'AB&&unknown;\ud83c');
  const xml = '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>a&#x110000;b</w:t></w:r></w:p></w:body></w:document>';
  assert.doesNotThrow(() => parseXml(xml));
});

test('review LOW: zipread bounds — oversized entries refused, sizes past the buffer rejected, bad input types rejected', async () => {
  assert.throws(() => readZip('not bytes'), /Uint8Array/);
  const z = writeZip([{ name: 'a.txt', data: 'hello' }]);
  // claim a huge uncompressed size in the central directory (offset 24 from the CD record)
  const cd = z.length - 22 - (46 + 5);
  const big = new Uint8Array(z);
  big[cd + 24] = 0xff; big[cd + 25] = 0xff; big[cd + 26] = 0xff; big[cd + 27] = 0x7f;
  assert.throws(() => readZip(big), /too large/);
  assert.doesNotThrow(() => readZip(big, { maxEntrySize: Infinity }));
  // compressed size past the end of the buffer
  const past = new Uint8Array(z);
  past[cd + 20] = 0xff; past[cd + 21] = 0xff;
  assert.throws(() => readZip(past), /past end of file/);
  // inflate guard: deflated entry whose real size exceeds the cap
  if (typeof CompressionStream === 'function') {
    const zz = await writeZipAsync([{ name: 'big.txt', data: 'x'.repeat(200000) }]);
    const entry = readZip(zz, { maxEntrySize: 300000 }).get('big.txt');
    assert.equal((await entry.bytes()).length, 200000);
    const entries = readZip(zz, { maxEntrySize: 300000 });
    // lie about the declared size so the header check passes, then let inflate hit the cap
    const cd2 = zz.length - 22 - (46 + 7);
    const lied = new Uint8Array(zz); lied[cd2 + 24] = 1; lied[cd2 + 25] = 0; lied[cd2 + 26] = 0; lied[cd2 + 27] = 0;
    await assert.rejects(readZip(lied, { maxEntrySize: 1000 }).get('big.txt').bytes(), /exceeds 1000 bytes/);
    void entries;
  }
});

test('review LOW: hasCloser is linear — a 20k-marker line parses in well under a second', () => {
  const line = '* '.repeat(20000) + 'end';
  const t0 = performance.now();
  const runs = parseInline(line);
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `parseInline took ${ms.toFixed(0)}ms`);
  assert.equal(runs.map((r) => r.text).join(''), line, 'unmatched markers stay literal');
  const line2 = '**a** '.repeat(5000);
  const t1 = performance.now();
  assert.equal(parseInline(line2).filter((r) => r.bold).length, 5000);
  assert.ok(performance.now() - t1 < 500);
});

test('review LOW: DECIMAL_RE — prose starting with "a. " / "i. " / "x) " at column 0 stays prose; indented letters are list items', () => {
  for (const s of ['a. Prose sentence.', 'i. e. for example', 'x) marks the spot', 'v. Wade', 'iv. roman']) {
    const b = textToBlocks(s)[0];
    assert.equal(b.numbering, undefined, s);
    assert.equal(b.runs[0].text, s);
    assert.equal(blocksToText([b]), s, 'round trips without escaping');
  }
  assert.deepEqual(textToBlocks('1. Numbered')[0].numbering, { kind: 'decimal', level: 0 });
  assert.deepEqual(textToBlocks('  a. Lettered sub-item')[0].numbering, { kind: 'decimal', level: 1 });
  assert.deepEqual(textToBlocks('    iv. roman sub-sub')[0].numbering, { kind: 'decimal', level: 2 });
  assert.equal(blocksToText(textToBlocks('1. one\n  a. sub\n    i. subsub')), '1. one\n  a. sub\n    i. subsub');
});

test('QA bug: underscore rules / signature lines are literal text, not underline markers', () => {
  for (const s of ['______________________________', 'Date: ____________', 'By: __________ Name', '|By: ______|Date: ____|', 'a __ b', 'x___y']) {
    const blocks = textToBlocks(s);
    const text = blocks[0].type === 'table' ? blocks[0].rows[0].map((c) => c[0].runs.map((r) => r.text).join('')).join('|') : blocks[0].runs.map((r) => r.text).join('');
    assert.equal(text, s.replace(/^\||\|$/g, ''), s);
    assert.ok(!blocks[0].runs?.some((r) => r.underline), 'no underline: ' + s);
    assert.deepEqual(textToBlocks(blocksToText(blocks)), blocks, 'round trip: ' + s);
    if (s !== 'a __ b') assert.equal(blocksToText(blocks), s, 'rules of 3+ underscores need no escaping: ' + s); // a lone "__" pair is escaped as \__
  }
  assert.deepEqual(parseInline('__u__ ok'), [{ text: 'u', underline: true }, { text: ' ok' }], 'real underline still works');
  assert.deepEqual(parseInline('__ not an opener__'), [{ text: '__ not an opener__' }], 'opener must be followed by non-space');
  assert.deepEqual(parseInline('** not bold**'), [{ text: '** not bold**' }]);
  assert.deepEqual(parseInline('**bold**'), [{ text: 'bold', bold: true }]);
});

test('QA bug: leading spaces in plain paragraphs are content (Word keeps them); only list items use them for nesting', () => {
  for (const s of ['  indented by spaces', '   ===== ]}', ' one space']) {
    const b = textToBlocks(s)[0];
    assert.equal(b.runs[0].text, s, s);
    assert.equal(b.numbering, undefined);
    assert.equal(blocksToText([b]), s);
  }
  assert.deepEqual(textToBlocks('  - nested')[0].numbering, { kind: 'bullet', level: 1 });
  assert.deepEqual(textToBlocks('  1. nested')[0].numbering, { kind: 'decimal', level: 1 });
  assert.equal(textToBlocks('  # not a heading')[0].style, 'Heading1', 'indented headings still headings');
  // paragraph text that *looks* like structure after a round trip is escaped so it comes back unchanged
  for (const runsText of ['\tstarts with tab', '  1. looks numbered', '  - looks bulleted', ' # looks heading', '1. numbered', '# heading', '---', '|pipe']) {
    const blocks = [{ type: 'paragraph', runs: [{ text: runsText }], style: 'Normal', align: 'left' }];
    const back = textToBlocks(blocksToText(blocks));
    assert.deepEqual(back, blocks, JSON.stringify(runsText) + ' -> ' + JSON.stringify(blocksToText(blocks)));
  }
});

test('QA bug: readDocx rejects non-docx input with a clear message and identifies legacy .doc files', async () => {
  await assert.rejects(readDocx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])), /legacy binary Word file .*\.doc/);
  await assert.rejects(readDocx(new Uint8Array(10)), /not a \.docx file — EOCD/);
  await assert.rejects(readDocx(Buffer.from('%PDF-1.4 not a zip at all')), /not a \.docx/);
});

test('QA bug: trailing table — the mandatory empty paragraph after it is not read back as a blank line', async () => {
  const text = '# H\n|a|b|\n|c|d|';
  const back = await readDocx(await buildDocx(textToBlocks(text)));
  assert.equal(back.text, text);
  // but a real trailing blank paragraph after a non-table block is kept
  const back2 = await readDocx(await buildDocx(textToBlocks('para\n')));
  assert.equal(back2.text, 'para');
});
