// QA: Word-realism of OUTPUT. Every sample's rendered text → docx, validated with unzip -t, xmllint (each part),
// textutil (Apple importer: html/rtf/txt) and LibreOffice when present; structure checks on document.xml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { samples } from '../samples/index.js';
import { assemble } from '../engine/index.js';
import { textToBlocks, blocksToText } from '../engine/docx/blocks.js';
import { buildDocx, buildDocxSync, buildDocumentXml } from '../engine/docx/docxwrite.js';
import { readDocx } from '../engine/docx/docxread.js';
import { readZipText } from '../engine/docx/zipread.js';

const OUT = '/private/tmp/claude-501/-Users-melod/3d0f23c6-a481-4b3b-a0b2-43cc231b3f85/scratchpad/docx-qa-out';
mkdirSync(OUT, { recursive: true });
const SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
function has(cmd) { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } }
const HAS = { unzip: has('unzip'), xmllint: has('xmllint'), textutil: process.platform === 'darwin' && has('textutil'), soffice: existsSync(SOFFICE) };

function walk(dir) { return readdirSync(dir).flatMap((n) => { const p = dir + '/' + n; return statSync(p).isDirectory() ? walk(p) : [p]; }); }

/** The plain text of each rendered line (via the block model), to look for in importer plain-text output. */
function plainLines(text) {
  const out = [];
  const para = (p) => out.push(p.runs.map((r) => r.text).join('').trim());
  for (const b of textToBlocks(text)) {
    if (b.type === 'paragraph') para(b);
    else if (b.type === 'table') for (const row of b.rows) for (const cell of row) for (const p of cell) para(p);
  }
  return out.filter((s) => s.length > 3);
}

function validate(t, name, bytes) {
  const file = `${OUT}/${name}.docx`;
  writeFileSync(file, bytes);
  const results = {};
  if (HAS.unzip) {
    const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.match(out, /No errors detected/, 'unzip -t');
    results.unzip = 'ok';
  }
  if (HAS.unzip && HAS.xmllint) {
    const dir = `${OUT}/x-${name}`;
    execFileSync('rm', ['-rf', dir]);
    execFileSync('unzip', ['-q', '-o', file, '-d', dir]);
    const parts = walk(dir);
    assert.ok(parts.length >= 8, 'expected 8 parts');
    for (const p of parts) execFileSync('xmllint', ['--noout', p], { stdio: 'pipe' }); // throws on malformed XML
    results.xmllint = `ok (${parts.length} parts)`;
  }
  if (HAS.textutil) {
    for (const fmt of ['html', 'rtf', 'txt']) execFileSync('textutil', ['-convert', fmt, '-output', `${OUT}/${name}.${fmt}`, file], { stdio: 'pipe' });
    results.textutil = 'ok';
  }
  if (HAS.soffice) {
    execFileSync(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', OUT, file], { stdio: 'pipe', timeout: 60000 });
    assert.ok(existsSync(`${OUT}/${name}.pdf`), 'LibreOffice produced a PDF');
    results.libreoffice = 'ok';
  } else results.libreoffice = 'skipped (not installed)';
  t.diagnostic(`${name}: ${JSON.stringify(results)}`);
  return file;
}

for (const s of samples) {
  test(`output: sample "${s.id}" builds a valid docx that importers accept with no lost text`, async (t) => {
    const { text, warnings } = assemble(s.text, s.sampleAnswers);
    assert.ok(text.length > 100, 'rendered text');
    const blocks = textToBlocks(text);
    const bytes = await buildDocx(blocks, { title: s.name });
    validate(t, `sample-${s.id}`, bytes);

    // no lost text: our own reader sees every rendered line, and Apple's importer (when present) too
    const back = await readDocx(bytes);
    assert.equal(back.text, blocksToText(blocks), 'readDocx(buildDocx(blocks)) reproduces blocksToText(blocks)');
    if (HAS.textutil) {
      const plain = readFileSync(`${OUT}/sample-${s.id}.txt`, 'utf8').replace(/\s+/g, ' ');
      for (const line of plainLines(text)) assert.ok(plain.includes(line.replace(/\s+/g, ' ')), `textutil lost: ${JSON.stringify(line)}`);
    }
    // structure in document.xml
    const xml = await readZipText(bytes, 'word/document.xml');
    const headings = blocks.filter((b) => b.type === 'paragraph' && /^Heading/.test(b.style)).length;
    assert.equal((xml.match(/<w:pStyle w:val="Heading[123]"\/>/g) || []).length, headings, 'every heading carries its pStyle');
    const breaks = blocks.filter((b) => b.type === 'pagebreak').length;
    assert.equal((xml.match(/<w:br w:type="page"\/>/g) || []).length, breaks, 'page breaks');
    const tables = blocks.filter((b) => b.type === 'table').length;
    assert.equal((xml.match(/<w:tbl>/g) || []).length, tables, 'tables');
    if (tables) assert.ok(xml.includes('<w:tblBorders><w:top w:val="single"'), 'tables have borders');
    const bolds = blocks.flatMap((b) => b.runs || []).filter((r) => r.bold).length;
    assert.ok((xml.match(/<w:b\/>/g) || []).length >= bolds, 'bold runs');
    const italics = blocks.flatMap((b) => b.runs || []).filter((r) => r.italic).length;
    assert.ok((xml.match(/<w:i\/>/g) || []).length >= italics, 'italic runs');
  });
}

test('output: numbered lists restart per list (distinct numId per group, startOverride 1) and the Apple importer sees list items', async (t) => {
  const text = ['1. a', '2. b', '  a. sub', 'Break paragraph.', '1. restarted', '2. again', '|t|', '1. after table', '---', '1. after page break', '- bullet', '  - nested'].join('\n');
  const blocks = textToBlocks(text);
  const xml = buildDocumentXml(blocks);
  const numIds = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => +m[1]);
  assert.deepEqual(numIds, [2, 2, 2, 3, 3, 4, 5, 1, 1], 'groups: [2,2,2] [3,3] [4] [5] bullets=1');
  assert.deepEqual([...xml.matchAll(/<w:ilvl w:val="(\d)"\/>/g)].map((m) => +m[1]), [0, 0, 1, 0, 0, 0, 0, 0, 1]);
  const bytes = await buildDocx(blocks, { title: 'lists' });
  const numbering = await readZipText(bytes, 'word/numbering.xml');
  for (const id of [2, 3, 4, 5]) assert.ok(numbering.includes(`<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>`), 'num ' + id + ' restarts at 1');
  assert.match(numbering, /<w:lvl w:ilvl="0"><w:start w:val="1"\/><w:numFmt w:val="decimal"\/><w:lvlText w:val="%1."\/>/);
  assert.match(numbering, /<w:lvl w:ilvl="1"><w:start w:val="1"\/><w:numFmt w:val="lowerLetter"\/><w:lvlText w:val="%2."\/>/);
  validate(t, 'lists', bytes);
  if (HAS.textutil) {
    const html = readFileSync(`${OUT}/lists.html`, 'utf8');
    // Apple's importer ignores numbering.xml entirely (verified against every numbering.xml variant): it shows every
    // w:numPr list as a bullet list. Word/LibreOffice honour the numbering. We only require that items are list items.
    assert.equal((html.match(/<li /g) || []).length, 9, 'all 9 list paragraphs are list items for Apple');
  }
});

test('output: special characters survive (XML-escaped in document.xml, intact after readDocx and textutil)', async (t) => {
  const special = 'Spec §1 ¶2 — “quoted” ’apos’ & <tag> a b 🎉 emoji ☃ 5 > 3 && 2 < 4 "q" \'s\'';
  const text = ['# ' + special, special, '|' + special + '|x|', '- ' + special].join('\n');
  const blocks = textToBlocks(text);
  const xml = buildDocumentXml(blocks);
  assert.ok(xml.includes('&lt;tag&gt;') && xml.includes('&amp;&amp;') && xml.includes('&quot;q&quot;') && !xml.includes('<tag>'), 'escaped');
  assert.ok(xml.includes(' ') && xml.includes('🎉') && xml.includes('§'), 'unicode kept raw (UTF-8)');
  const bytes = await buildDocx(blocks, { title: 'special §' });
  validate(t, 'special', bytes);
  const back = await readDocx(bytes);
  assert.equal(back.text, blocksToText(blocks));
  assert.equal(back.blocks[1].runs[0].text, special);
  if (HAS.textutil) {
    const plain = readFileSync(`${OUT}/special.txt`, 'utf8');
    for (const n of ['§1 ¶2 —', '“quoted” ’apos’', '& <tag>', 'a b', '🎉 emoji ☃', '5 > 3 && 2 < 4']) assert.ok(plain.includes(n), 'textutil lost ' + n);
  }
});

test('output: control characters are stripped from document.xml (Word rejects them) but tabs/newlines are kept', () => {
  const xml = buildDocumentXml([{ type: 'paragraph', runs: [{ text: 'a bc\td\neF' }] }]);
  assert.ok(xml.includes('<w:t xml:space="preserve">abc</w:t><w:tab/><w:t xml:space="preserve">d</w:t><w:br/><w:t xml:space="preserve">eF</w:t>'), xml);
});

test('output: very long paragraph, empty document, table-only document', async (t) => {
  const long = 'Lorem ipsum dolor sit amet, consectetur. '.repeat(5000); // ~200 KB single paragraph
  let bytes = await buildDocx(textToBlocks(long), { title: 'long' });
  validate(t, 'longpara', bytes);
  let back = await readDocx(bytes);
  assert.equal(back.blocks.length, 1);
  assert.equal(back.blocks[0].runs[0].text, long);

  bytes = await buildDocx(textToBlocks(''), { title: 'empty' });
  validate(t, 'empty', bytes);
  back = await readDocx(bytes);
  assert.equal(back.text, '');
  bytes = await buildDocx([], { title: 'empty2' });
  validate(t, 'empty2', bytes);
  assert.equal((await readDocx(bytes)).blocks.length, 0);

  bytes = await buildDocx(textToBlocks('|a|b|\n|c|d|'), { title: 'table-only' });
  validate(t, 'tableonly', bytes);
  const xml = await readZipText(bytes, 'word/document.xml');
  assert.match(xml, /<\/w:tbl><w:p\/><w:sectPr>/, 'Word requires a paragraph after a trailing table');
  back = await readDocx(bytes);
  assert.equal(back.text, '|a|b|\n|c|d|', 'the required trailing paragraph is not content');
  assert.deepEqual(back.blocks.map((b) => b.type), ['table']);
});

test('output: 200-page document builds and re-reads in under 2 seconds and validates', async (t) => {
  const page = `## Section heading\n${'Body text for this page, with **bold** and *italic* words. '.repeat(40)}\n1. one\n2. two\n  a. sub\n|k|v|\n|x|y|\n---`;
  const text = Array.from({ length: 200 }, (_, i) => page.replace('Section', 'Section ' + (i + 1))).join('\n');
  const blocks = textToBlocks(text);
  let t0 = performance.now();
  const bytes = await buildDocx(blocks, { title: '200 pages' });
  const build = performance.now() - t0;
  t0 = performance.now();
  const sync = buildDocxSync(blocks, { title: '200 pages' });
  const buildSync = performance.now() - t0;
  t0 = performance.now();
  const back = await readDocx(bytes);
  const read = performance.now() - t0;
  t.diagnostic(`200 pages: build=${build.toFixed(0)}ms sync=${buildSync.toFixed(0)}ms read=${read.toFixed(0)}ms bytes=${bytes.length} (store ${sync.length})`);
  assert.ok(build < 2000, 'build < 2s: ' + build);
  assert.ok(read < 2000, 'read < 2s: ' + read);
  assert.equal(back.text, blocksToText(blocks));
  assert.equal(back.blocks.filter((b) => b.type === 'pagebreak').length, 200);
  validate(t, 'bigpage', bytes);
});

test('output: document options land in styles.xml, sectPr and as direct run formatting (for importers that ignore styles.xml)', async (t) => {
  const bytes = await buildDocx(textToBlocks('>title T\n# H1\n## H2\n### H3\nBody'), { title: 'opts', font: 'Garamond', fontSize: 11, margins: { top: 0.5, right: 1, bottom: 0.75, left: 1.25 }, lineSpacing: 1.5 });
  const styles = await readZipText(bytes, 'word/styles.xml');
  assert.ok(styles.includes('w:ascii="Garamond"') && styles.includes('<w:sz w:val="22"/>') && styles.includes('w:line="360"'));
  const doc = await readZipText(bytes, 'word/document.xml');
  assert.ok(doc.includes('<w:pgMar w:top="720" w:right="1440" w:bottom="1080" w:left="1800"'));
  // direct formatting: body 11pt, H3 11pt, H2 13pt, H1 15pt, Title 19pt; Title centered directly
  for (const [sz, txt] of [[38, 'T'], [30, 'H1'], [26, 'H2'], [22, 'H3'], [22, 'Body']]) {
    assert.ok(doc.includes(`<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${txt}</w:t>`), `${txt} has direct size ${sz}`);
  }
  assert.ok(doc.includes('<w:pStyle w:val="Title"/><w:jc w:val="center"/>'));
  const back = await readDocx(bytes);
  assert.equal(back.text, '>title T\n# H1\n## H2\n### H3\nBody', 'direct formatting is not read back as content');
  validate(t, 'opts', bytes);
  if (HAS.textutil) {
    const rtf = readFileSync(`${OUT}/opts.rtf`, 'utf8');
    for (const fs of ['\\fs38', '\\fs30', '\\fs26', '\\fs22']) assert.ok(rtf.includes(fs), 'Apple importer sees ' + fs);
    assert.ok(rtf.includes('\\qc'), 'Apple importer centers the Title');
  }
});
