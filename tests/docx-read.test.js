import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { parseDocumentXml, readDocx, fixFieldQuotes } from '../engine/docx/docxread.js';
import { readZip } from '../engine/docx/zipread.js';

const OUT = '/private/tmp/claude-501/-Users-melod/3d0f23c6-a481-4b3b-a0b2-43cc231b3f85/scratchpad/docx-test-out';
mkdirSync(OUT, { recursive: true });

const FRAG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Dear </w:t></w:r><w:r><w:rPr><w:b/><w:i w:val="0"/></w:rPr><w:t>{[</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Client.</w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:rPr><w:b/></w:rPr><w:t>Name</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>]}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> &amp; co</w:t></w:r></w:p>
<w:p><w:r><w:t>{[SigningDate|format:</w:t></w:r><w:r><w:t>“MMMM d, yyyy”</w:t></w:r><w:r><w:t>]} said “hello”</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="both"/><w:ind w:left="1440"/></w:pPr><w:r><w:t>x</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Titre"/></w:pPr><w:r><w:t>T</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/></w:body></w:document>`;
const NUM = `<w:numbering xmlns:w="x"><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="7"/></w:num></w:numbering>`;
const STYLES = `<w:styles xmlns:w="x"><w:style w:styleId="Titre"><w:name w:val="Title"/></w:style></w:styles>`;

test('split-run placeholder reassembly, smart quotes inside fields, styles by name', () => {
  const b = parseDocumentXml(FRAG, NUM, STYLES);
  assert.deepEqual(b[0], { type: 'paragraph', runs: [{ text: 'Dear {[Client.Name]} & co', bold: true }], style: 'Heading1', align: 'left' });
  assert.equal(b[1].runs[0].text, '{[SigningDate|format:"MMMM d, yyyy"]} said “hello”');
  assert.equal(b[2].type, 'pagebreak', 'page break inside a paragraph is emitted before it');
  assert.deepEqual(b[3], { type: 'paragraph', runs: [{ text: 'x' }], style: 'Normal', align: 'justify', indent: 2 });
  assert.equal(b[4].type, 'pagebreak');
  assert.equal(b[5].style, 'Title');
  assert.deepEqual(b[6].numbering, { kind: 'decimal', level: 0 });
  assert.equal(b[7].type, 'table');
  assert.equal(b[7].rows[0][0][0].runs[0].text, 'c');
});

test('fixFieldQuotes keeps run boundaries', () => {
  const r = fixFieldQuotes([{ text: '{[a|default:“', bold: true }, { text: 'x”]} “out”', bold: false }]);
  assert.equal(r[0].text, '{[a|default:"');
  assert.equal(r[1].text, 'x"]} “out”');
});

test('reads a DEFLATE-compressed docx written by python zipfile', async (t) => {
  let ok = true;
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); } catch { ok = false; }
  if (!ok) return t.skip('python3 not available');
  writeFileSync(OUT + '/frag.xml', FRAG);
  execFileSync('python3', ['-c', `
import zipfile
z=zipfile.ZipFile('${OUT}/deflated.docx','w',zipfile.ZIP_DEFLATED)
z.write('${OUT}/frag.xml','word/document.xml')
z.writestr('[Content_Types].xml','<Types/>')
z.close()`]);
  const bytes = new Uint8Array(readFileSync(OUT + '/deflated.docx'));
  assert.equal(readZip(bytes).get('word/document.xml').method, 8);
  const { text, blocks } = await readDocx(bytes);
  assert.equal(blocks[0].runs[0].text, 'Dear {[Client.Name]} & co');
  assert.equal(text.split('\n')[0], '# **Dear {[Client.Name]} & co**');
  assert.equal(text.split('\n')[2], '---');
});

test('core modules use no Node-only APIs', () => {
  for (const f of ['zipwrite.js', 'zipread.js', 'docxwrite.js', 'docxread.js', 'blocks.js', 'html.js']) {
    const src = readFileSync(new URL('../engine/docx/' + f, import.meta.url), 'utf8');
    assert.ok(!/\bBuffer\b|from 'node:|from "node:|require\(/.test(src), f + ' uses node APIs');
  }
});
