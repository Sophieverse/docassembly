// QA attack suite for engine/docx/fill.js: Word-like run splitting, formatting inheritance, block structure,
// hostile values, package fidelity, performance and the app round-trip (extractTemplateText → compile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fillDocx, fillPartXml, partTemplateText, extractTemplateText } from '../engine/docx/fill.js';
import { readDocx } from '../engine/docx/docxread.js';
import { readZip, readZipText } from '../engine/docx/zipread.js';
import { buildDocx } from '../engine/docx/docxwrite.js';
import { textToBlocks } from '../engine/docx/blocks.js';
import { compile, tokenize, questionnaire } from '../engine/index.js';
import { samples } from '../samples/index.js';
import { makeDocx, docXml, hdrXml, p, r, tp, OUT, checkDocx, textutil, W_NS } from './docx-fill-fixtures.js';

const dec = new TextDecoder();
const body = (xml) => xml.replace(/^[\s\S]*<w:body>/, '').replace(/<w:sectPr><w:pgSz[\s\S]*$/, '');
const paraTexts = (xml) => [...body(xml).matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((m) => m[1].replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, ''));
const NUM = '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const TBL = '<w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>';
const tc = (inner, pr = '<w:tcW w:w="3000" w:type="dxa"/>') => `<w:tc><w:tcPr>${pr}</w:tcPr>${inner}</w:tc>`;
const tr = (cells, attrs = ' w:rsidR="00AA11BB"') => `<w:tr${attrs}>${cells.join('')}</w:tr>`;

// ---------- 1. tags split across runs the way Word splits them ----------
test('tag split across runs with proofErr, bookmarks, lastRenderedPageBreak and rsids', () => {
  const para = p([
    r('Dear ', '', ' w:rsidR="00111111"'),
    r('{[', '<w:b/>', ' w:rsidRPr="00222222"'),
    '<w:proofErr w:type="spellStart"/>',
    '<w:bookmarkStart w:id="0" w:name="_GoBack"/>',
    r('Cli', '', ' w:rsidR="00333333"'),
    '<w:bookmarkEnd w:id="0"/>',
    '<w:r w:rsidR="00444444"><w:lastRenderedPageBreak/><w:t>ent.</w:t></w:r>',
    r('Name', '', ' w:rsidR="00555555"'),
    '<w:proofErr w:type="spellEnd"/>',
    r(']}, hello.'),
  ]);
  const res = fillPartXml(docXml(para), { Client: { Name: 'Zed' } });
  assert.deepEqual(res.warnings, []);
  assert.deepEqual(paraTexts(res.xml), ['Dear Zed, hello.']);
  assert.ok(res.xml.includes('<w:r w:rsidRPr="00222222"><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Zed</w:t></w:r>'), 'value run keeps the rsid and bold of the run where the tag started');
  for (const keep of ['<w:proofErr w:type="spellStart"/>', '<w:bookmarkStart w:id="0" w:name="_GoBack"/>', '<w:bookmarkEnd w:id="0"/>', '<w:lastRenderedPageBreak/>']) assert.ok(res.xml.includes(keep), keep);
  assert.equal(partTemplateText(docXml(para)), 'Dear {[Client.Name]}, hello.');
});

test('xml:space="preserve" spaces around a tag survive; a tag ending at a run boundary is clean', () => {
  const res = fillPartXml(docXml(p([r('  {[A]}  '), r('{[B]}'), r('  x  ')])), { A: 'a', B: 'b' });
  assert.deepEqual(paraTexts(res.xml), ['  a  b  x  ']);
  assert.ok(!res.xml.includes('<w:t xml:space="preserve"></w:t>'), 'no empty text nodes');
});

test('"{[" at the end of a paragraph and "]}" in the next: left literal with a warning, nothing crashes', () => {
  const xml = docXml(p([r('Hello {[')]) + p([r('Name]} there {[Name]}')]));
  const res = fillPartXml(xml, { Name: 'Zed' });
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /Unterminated field "\{\[" in paragraph "Hello \{\["/);
  assert.deepEqual(paraTexts(res.xml), ['Hello {[', 'Name]} there Zed']);
  assert.equal(partTemplateText(xml), 'Hello {[\nName]} there {[Name]}');
});

test('"{" and "[" as separate runs, "]}" split, tag text spanning a tab run is not a tag', () => {
  const res = fillPartXml(docXml(p([r('{'), r('['), r('N'), r(']'), r('}')]) + p([r('{['), r('\t'), r('N]}')])), { N: 'v' });
  assert.equal(paraTexts(res.xml)[0], 'v');
  assert.ok(res.warnings.length <= 1);
});

// ---------- 2. formatting inheritance ----------
test('bold "{[" run wins over an italic remainder; hyperlink, inline sdt, header sdt, footnote', () => {
  const res = fillPartXml(docXml(p([r('{[', '<w:b/>'), r('N]}', '<w:i/>')])), { N: 'v' });
  assert.ok(res.xml.includes('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">v</w:t></w:r>'));
  assert.ok(!res.xml.includes('<w:i/>'), 'the italic leftover run is consumed');

  const link = fillPartXml(docXml(p(['<w:hyperlink r:id="rId7">', r('{[', '<w:rStyle w:val="Hyperlink"/>'), r('U]}', '<w:rStyle w:val="Hyperlink"/>'), '</w:hyperlink>'])), { U: 'x.example' });
  assert.ok(link.xml.includes('<w:hyperlink r:id="rId7"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">x.example</w:t></w:r></w:hyperlink>'));

  const sdt = fillPartXml(docXml(p([r('a '), '<w:sdt><w:sdtPr><w:alias w:val="n"/><w:id w:val="1"/></w:sdtPr><w:sdtEndPr/><w:sdtContent>', r('{[', '<w:color w:val="FF0000"/>'), r('N]}'), '</w:sdtContent></w:sdt>', r(' b')])), { N: 'v' });
  assert.ok(sdt.xml.includes('<w:sdt><w:sdtPr><w:alias w:val="n"/><w:id w:val="1"/></w:sdtPr><w:sdtEndPr/><w:sdtContent><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">v</w:t></w:r></w:sdtContent></w:sdt>'));
  assert.deepEqual(paraTexts(sdt.xml), ['a v b']);

  const hdr = fillPartXml(hdrXml('<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Page Numbers (Top of Page)"/></w:docPartObj></w:sdtPr><w:sdtContent>' + tp('Hdr {[N]}', '<w:pStyle w:val="Header"/>') + '</w:sdtContent></w:sdt>'), { N: 'v' }, {}, 'header1');
  assert.ok(hdr.xml.includes('<w:sdtContent><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t xml:space="preserve">Hdr </w:t></w:r><w:r><w:t xml:space="preserve">v</w:t></w:r></w:p></w:sdtContent>'));

  const fn = `<w:footnotes ${W_NS}><w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> See {[Cite]}.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const fres = fillPartXml(fn, { Cite: 'Smith v. Jones' }, {}, 'footnotes');
  assert.ok(fres.xml.includes('<w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> See </w:t></w:r><w:r><w:t xml:space="preserve">Smith v. Jones</w:t></w:r><w:r><w:t xml:space="preserve">.</w:t></w:r>'));
});

test('text box: Choice and Fallback filled identically, including a paragraph-level list inside', () => {
  const NS = W_NS + ' xmlns:wps="x" xmlns:v="y"';
  const inner = tp('{[list L]}') + p([r('- '), r('{[_item]}', '<w:b/>')]) + tp('{[end list]}') + tp('after {[N]}');
  const box = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${inner}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
  const res = fillPartXml(`<w:document ${NS}><w:body>${box}<w:sectPr/></w:body></w:document>`, { L: ['a', 'b'], N: 'n' });
  assert.deepEqual(res.warnings, []);
  const boxes = [...res.xml.matchAll(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/g)].map((m) => m[1]);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0], boxes[1]);
  assert.deepEqual(paraTexts('<w:body>' + boxes[0]), ['- a', '- b', 'after n']);
});

// ---------- 3. structure ----------
test('paragraph-level if/else among numbered paragraphs keeps numPr on survivors and drops markers', () => {
  const xml = docXml(tp('one', NUM) + tp('{[if A]}', NUM) + tp('two', NUM) + tp('{[else]}', NUM) + tp('alt', NUM) + tp('{[end if]}', NUM) + tp('three', NUM));
  for (const [A, want] of [[true, ['one', 'two', 'three']], [false, ['one', 'alt', 'three']]]) {
    const res = fillPartXml(xml, { A });
    assert.deepEqual(res.warnings, []);
    assert.deepEqual(paraTexts(res.xml), want);
    assert.equal((res.xml.match(/<w:numPr>/g) || []).length, 3);
    assert.ok(!res.xml.includes('<w:p><w:pPr>' + NUM + '</w:pPr></w:p>'), 'no empty numbered paragraphs (they would show as blank list items)');
  }
});

test('nested list inside if inside a paragraph-level list; a list whose body holds a table', () => {
  const xml = docXml(tp('{[list L]}') + tp('{[N]}', NUM) + tp('{[if Sub]}') + tp('{[list Sub]}') + tp('- {[_item]}', '<w:ind w:left="1440"/>') + tp('{[end list]}') + tp('{[end if]}')
    + '<w:tbl>' + TBL + tr([tc(tp('cell {[N]}'))]) + '</w:tbl>' + tp('{[end list]}') + tp('fin'));
  const res = fillPartXml(xml, { L: [{ N: 'a', Sub: ['s1', 's2'] }, { N: 'b', Sub: [] }] });
  assert.deepEqual(res.warnings, []);
  assert.deepEqual(paraTexts(res.xml), ['a', '- s1', '- s2', 'cell a', 'b', 'cell b', 'fin']);
  assert.equal((res.xml.match(/<w:tbl>/g) || []).length, 2);
  assert.equal((res.xml.match(/<w:numPr>/g) || []).length, 2);
});

test('row list with gridSpan cells and a nested table with its own row list; row-level if', () => {
  const nested = '<w:tbl>' + TBL + tr([tc(p([r('{[list Sub]}'), r('{[_item]}', '<w:i/>')])), tc(p([r('{[end list]}')]))]) + '</w:tbl>';
  const tbl = '<w:tbl>' + TBL
    + tr([tc(tp('Name'), '<w:gridSpan w:val="2"/>'), tc(tp('Subs'))], ' w:rsidR="00HEAD"')
    + tr([tc(tp('{[list Rows]}{[Name]}'), '<w:gridSpan w:val="2"/>'), tc(tp('intro') + nested + tp('{[end list]}'))])
    + tr([tc(tp('{[if Show]}Shown'), '<w:gridSpan w:val="3"/>'), tc(tp('{[end if]}'))])
    + tr([tc(tp('{[if Show2]}A')), tc(tp('B')), tc(tp('C{[end if]}'))])
    + '</w:tbl>';
  const data = { Rows: [{ Name: 'r1', Sub: ['x', 'y'] }, { Name: 'r2', Sub: [] }], Show: false, Show2: true };
  const res = fillPartXml(docXml(tbl + tp('')), data);
  assert.deepEqual(res.warnings, []);
  const outer = res.xml.slice(res.xml.indexOf('<w:tbl>'));
  const topRows = outer.match(/<w:tr w:rsidR="00AA11BB">|<w:tr w:rsidR="00HEAD">/g);
  assert.equal(topRows.length, 1 + 2 + 2 + 1, 'header + 2 list rows (each with 2 nested rows counted too) + if row');
  assert.equal((res.xml.match(/<w:gridSpan w:val="2"\/>/g) || []).length, 3);
  assert.ok(!res.xml.includes('Shown'));
  assert.deepEqual(paraTexts(res.xml).filter(Boolean), ['Name', 'Subs', 'r1', 'intro', 'x', 'y', 'r2', 'intro', 'A', 'B', 'C']);
  // nested-table cell that lost all rows keeps a paragraph; nested table for r2 disappears entirely.
  assert.equal((res.xml.match(/<w:tbl>/g) || []).length, 2);
});

test('marker paragraph with trailing tab/space runs and a pPr/rPr is still a marker', () => {
  const xml = docXml(p([r('{[if A]}', '<w:b/>'), r('\t'), r('   ', '<w:i/>')], '<w:rPr><w:b/></w:rPr>') + tp('x') + p([r('{[end if]}'), r('\t')], '<w:rPr><w:i/></w:rPr>') + tp('y'));
  const on = fillPartXml(xml, { A: true }), off = fillPartXml(xml, { A: false });
  assert.deepEqual(on.warnings, []);
  assert.deepEqual(paraTexts(on.xml), ['x', 'y']);
  assert.deepEqual(paraTexts(off.xml), ['y']);
});

test('marker paragraph carrying w:sectPr: the section break is kept as an empty paragraph exactly once', () => {
  const sect = '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840" w:orient="landscape"/></w:sectPr>';
  const xml = docXml(tp('{[if A]}') + tp('x') + p([r('{[end if]}')], sect) + tp('after'));
  for (const [A, want] of [[true, ['x', '', 'after']], [false, ['', 'after']]]) {
    const res = fillPartXml(xml, { A });
    assert.deepEqual(res.warnings, []);
    assert.deepEqual(paraTexts(res.xml), want);
    assert.ok(res.xml.includes(`<w:p><w:pPr>${sect}</w:pPr></w:p>`));
    assert.equal((res.xml.match(/<w:sectPr>/g) || []).length, 2, 'section break + final body sectPr');
  }
  // list opener with a section break: not repeated per item.
  const lst = fillPartXml(docXml(tp('before') + p([r('{[list L]}')], sect) + tp('{[_item]}') + tp('{[end list]}') + tp('after')), { L: ['a', 'b', 'c'] });
  assert.deepEqual(paraTexts(lst.xml), ['before', '', 'a', 'b', 'c', 'after']);
  assert.equal((lst.xml.match(/<w:sectPr>/g) || []).length, 2);
});

test('stray {[end if]}, if opened at paragraph level closed inline, unterminated block at EOF: warn, stay intact', () => {
  const stray = fillPartXml(docXml(tp('a') + tp('{[end if]}') + tp('b {[N]}')), { N: 1 });
  assert.equal(stray.warnings.length, 1);
  assert.match(stray.warnings[0], /\{\[end if\]\} has no matching \{\[if\]\} \(paragraph-level block in document body\)/);
  assert.deepEqual(paraTexts(stray.xml), ['a', '{[end if]}', 'b 1']);

  const mixed = fillPartXml(docXml(tp('{[if A]}') + tp('x {[end if]} y {[N]}')), { A: true, N: 1 });
  assert.equal(mixed.warnings.length, 2);
  assert.deepEqual(paraTexts(mixed.xml), ['{[if A]}', 'x {[end if]} y 1']);

  const open = fillPartXml(docXml(tp('{[list Items]}') + tp('{[Name]}')), { Items: [{ Name: 'q' }] });
  assert.match(open.warnings[0], /\{\[list Items\]\} has no matching \{\[end list\]\}/);
  assert.deepEqual(paraTexts(open.xml), ['{[list Items]}', '']);
  assert.ok(open.xml.includes('<w:sectPr>'));

  const tblOpen = fillPartXml(docXml('<w:tbl>' + TBL + tr([tc(tp('{[list Items]}')), tc(tp('')), tc(tp(''))]) + tr([tc(tp('{[Name]}')), tc(tp('')), tc(tp(''))]) + '</w:tbl>' + tp('z')), { Items: [{ Name: 'q' }] });
  assert.match(tblOpen.warnings[0], /\{\[list Items\]\} has no matching \{\[end list\]\} \(row-level block in table\)/);
  assert.ok(tblOpen.xml.includes('{[list Items]}') && tblOpen.xml.includes('>z<'));
  assert.equal((tblOpen.xml.match(/<w:tr /g) || []).length, 2, 'both rows survive');
});

test('an emptied block-level content control keeps a paragraph', () => {
  const res = fillPartXml(docXml('<w:sdt><w:sdtPr><w:id w:val="9"/></w:sdtPr><w:sdtContent>' + tp('{[if A]}') + tp('in') + tp('{[end if]}') + '</w:sdtContent></w:sdt>' + tp('x')), { A: false });
  assert.ok(res.xml.includes('<w:sdtContent><w:p/></w:sdtContent>'));
});

// ---------- 4. values ----------
test('hostile values: newlines, tabs, xml specials, unicode, emoji, 100 KB, scalars, lists, missing, injection', () => {
  const big = 'x'.repeat(100 * 1024) + '&<>';
  const data = { A: 'l1\r\nl2\tt', B: '&<>"\'', C: 'ünï ✓ 🎉 中文', D: 42.5, E: '2026-01-05', F: false, G: ['x', 'y', 'z'], H: '{[if A]}boom{[end if]} {[A]}', Big: big, N: null };
  const res = fillPartXml(docXml(tp('{[A]}|{[B]}|{[C]}|{[D]}|{[E]}|{[F]}|{[G]}|{[H]}|{[Missing]}|{[Deep.Path]}|{[N]}') + tp('{[Big]}')), data);
  assert.deepEqual(res.warnings, ['Missing value: Missing', 'Missing value: Deep.Path', 'Missing value: N']);
  const [line, bigLine] = paraTexts(res.xml.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  assert.equal(line, 'l1\nl2\tt|&<>"\'|ünï ✓ 🎉 中文|42.5|January 5, 2026|No|x, y, z|{[if A]}boom{[end if]} {[A]}|||');
  assert.equal(bigLine, big);
  assert.ok(res.xml.includes('<w:t xml:space="preserve">l1</w:t><w:br/><w:t xml:space="preserve">l2</w:t><w:tab/><w:t xml:space="preserve">t</w:t>'));
  assert.ok(res.xml.includes('&amp;&lt;&gt;&quot;'), 'escaped');
  assert.ok(res.xml.includes('{[if A]}boom{[end if]}'), 'value with tags is emitted verbatim, never re-evaluated');
  assert.ok(!res.xml.includes('boom</w:t></w:r><w:r>'), 'the injected if did not become a block');
});

// ---------- 5. fidelity of the whole package ----------
let attackBytes, attackOut;
test('full package: well-formed, unzip -t, [Content_Types].xml first, untouched parts byte-identical, textutil', async () => {
  const sect = '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
  const bodyXml = p([r('Re: '), r('{[', '<w:b/>'), r('Client.Name]}')], '<w:pStyle w:val="Title"/>')
    + tp('{[if A]}', NUM) + tp('yes {[V]}', NUM) + p([r('{[else]}'), r('\t')], NUM) + tp('no', NUM) + p([r('{[end if]}')], sect)
    + '<w:tbl>' + TBL + tr([tc(tp('{[list Rows]}{[Name]}'), '<w:gridSpan w:val="2"/>'), tc(tp('{[Qty]}{[end list]}'))]) + '</w:tbl>'
    + tp('Notes: {[Notes]}');
  const hdr = hdrXml(tp('{[Client.Name]} — {[Missing]}'));
  const fn = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ${W_NS}><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> {[Cite]}</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  attackBytes = await makeDocx({ 'word/document.xml': docXml(bodyXml), 'word/header1.xml': hdr, 'word/footnotes.xml': fn }, { name: 'qa-attack' });
  attackOut = await fillDocx(attackBytes, { Client: { Name: 'Ann & Co' }, A: true, V: 'v', Rows: [{ Name: 'a', Qty: 1 }, { Name: 'b', Qty: 2 }], Notes: 'x\ny', Cite: 'Roe' });
  assert.deepEqual(attackOut.warnings, ['header1: Missing value: Missing']);
  writeFileSync(OUT + '/qa-attack-filled.docx', attackOut.bytes);
  assert.deepEqual(await checkDocx(OUT + '/qa-attack-filled.docx'), []);
  const zin = readZip(attackBytes), zout = readZip(attackOut.bytes);
  assert.equal([...zout.keys()][0], '[Content_Types].xml');
  assert.deepEqual([...zout.keys()], [...zin.keys()], 'same entries in the same order');
  for (const [name, e] of zin) {
    const a = dec.decode(await e.bytes()), b = dec.decode(await zout.get(name).bytes());
    if (/word\/(document|header1|footnotes)\.xml/.test(name)) assert.notEqual(a, b, name); else assert.equal(a, b, name + ' byte-identical');
  }
  const tu = textutil(OUT + '/qa-attack-filled.docx');
  if (tu != null) {
    assert.ok(tu.includes('Re: Ann & Co'), tu);
    assert.ok(tu.includes('yes v') && !tu.includes('no\n'), tu);
    assert.ok(/a\s+1/.test(tu) && /b\s+2/.test(tu), tu);
    assert.match(tu, /Notes: x[\n\u2028]y/, 'w:br renders as a line separator');
    assert.ok(!tu.includes('{['), tu);
  }
  const { text } = await readDocx(attackOut.bytes);
  assert.ok(text.includes('Re: **Ann & Co**') || text.includes('Ann & Co'), text);
});

test('python zipfile reads the result: first entry is [Content_Types].xml and every entry passes testzip', () => {
  const { spawnSync } = require_child();
  const r_ = spawnSync('python3', ['-c', `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); print(z.namelist()[0]); print(z.testzip())`, OUT + '/qa-attack-filled.docx'], { encoding: 'utf8' });
  if (r_.status !== 0) return; // no python3
  assert.equal(r_.stdout.trim(), '[Content_Types].xml\nNone');
});
function require_child() { return { spawnSync: (...a) => spawnSyncImpl(...a) }; }
import { spawnSync as spawnSyncImpl } from 'node:child_process';

test('performance: a 300-page document (9000 paragraphs, 2000 field tags, 600 block tags) fills in < 2 s', async () => {
  let b = '';
  for (let i = 0; i < 9000; i++) {
    if (i % 30 === 0) b += tp('{[if Flag]}');
    b += i % 4 === 0 && i < 8000
      ? p([r('Para ' + i + ' says '), r('{[', '<w:b/>'), r('Client.'), r('Name]}'), r(' and {[Fee|currency]}.')])
      : p([r(('Plain paragraph ' + i + ' with filler text to make it a realistic length. ').repeat(3))]);
    if (i % 30 === 5) b += tp('{[end if]}');
  }
  const bytes = await makeDocx({ 'word/document.xml': docXml(b) }, { name: 'qa-perf' });
  const t0 = performance.now();
  const res = await fillDocx(bytes, { Client: { Name: 'Ann' }, Fee: 12, Flag: true });
  const ms = performance.now() - t0;
  assert.deepEqual(res.warnings, []);
  assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms`);
  const xml = await readZipText(res.bytes, 'word/document.xml');
  assert.equal((xml.match(/>Ann</g) || []).length, 2000);
  assert.ok(!xml.includes('{['));
});

// ---------- 6. app round-trip ----------
test('tutorial sample → buildDocx → extractTemplateText compiles to the same variables and questionnaire', async () => {
  const sample = samples.find((s) => s.id === 'tutorial');
  // Multi-line comments become several paragraphs in a .docx; drop them (annotations live in the stored model).
  const src = tokenize(sample.text).filter((t) => !(t.type === 'field' && t.value.startsWith('#'))).map((t) => (t.type === 'field' ? `{[${t.value}]}` : t.value)).join('').replace(/^\n+/, '');
  const docx = await buildDocx(textToBlocks(src), { title: sample.name });
  const text = await extractTemplateText(docx);
  const a = compile(src), b = compile(text);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
  assert.deepEqual([...b.analysis.variables.keys()].sort(), [...a.analysis.variables.keys()].sort());
  for (const [k, v] of a.analysis.variables) assert.equal(b.analysis.variables.get(k).type, v.type, k);
  const qa = questionnaire(a.ast, sample.sampleAnswers), qb = questionnaire(b.ast, sample.sampleAnswers);
  assert.deepEqual(qb.map((q) => q.path), qa.map((q) => q.path));
  // and the original (with comments) yields the same variable set as well
  const full = compile(sample.text);
  assert.deepEqual([...full.analysis.variables.keys()].sort(), [...b.analysis.variables.keys()].sort());
  const filled = await fillDocx(docx, sample.sampleAnswers);
  assert.ok(!(await readDocx(filled.bytes)).text.includes('{['));
  writeFileSync(OUT + '/qa-tutorial-filled.docx', filled.bytes);
  assert.deepEqual(await checkDocx(OUT + '/qa-tutorial-filled.docx'), []);
});
