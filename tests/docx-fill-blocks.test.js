import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fillDocx, fillPartXml, extractTemplateText } from '../engine/docx/fill.js';
import { readDocx } from '../engine/docx/docxread.js';
import { readZipText } from '../engine/docx/zipread.js';
import { buildDocx } from '../engine/docx/docxwrite.js';
import { textToBlocks } from '../engine/docx/blocks.js';
import { compile, assemble, tokenize } from '../engine/index.js';
import { samples } from '../samples/index.js';
import { makeDocx, docXml, p, r, tp, OUT, checkDocx, textutil } from './docx-fill-fixtures.js';

const NUM = '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const TBL_HEAD = '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid><w:gridCol w:w="4675"/><w:gridCol w:w="4675"/></w:tblGrid>';
const cell = (inner, w = '4675') => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:tcPr>${inner}</w:tc>`;
const row = (cells, trPr = '') => `<w:tr w:rsidR="00112233">${trPr}${cells.join('')}</w:tr>`;

// The will: paragraph-level if/else blocks, a numbered inline list with _punc, a Knackly table row list,
// a nested if inside a paragraph-level list, and a comment paragraph.
const WILL = [
  p([r('ARTICLE I — FAMILY', '<w:b/>')], '<w:pStyle w:val="Heading1"/>'),
  tp('{[if IsMarried]}'),
  p([r('I am married to '), r('{[Spouse.FullName]}', '<w:b/>'), r(', and all references to my spouse are to '), r('{[Spouse.Pronoun|pronoun:"object"]}'), r('.')], '<w:jc w:val="both"/>'),
  tp('{[else]}'),
  tp('I am not married.'),
  tp('{[end if]}'),
  p([r('{[# drafter note: children clause follows]}')]),
  p([r('My children are '), r('{[list Children]}{[Name]}{[_punc]}{[end list]}'), r('.')], NUM),
  p([r('{[list Children]}')]),
  p([r('{[_index]}. '), r('{[Name]}', '<w:i/>'), r('{[if IsMinor]}'), r(' (a minor)'), r('{[end if]}'), r(' — born '), r('{[DOB|format:"long"]}')], '<w:ind w:left="720"/>'),
  p([r('{[end list]}')]),
  '<w:tbl>' + TBL_HEAD
    + row([cell(p([r('Beneficiary', '<w:b/>')])), cell(p([r('Share', '<w:b/>')]))], '<w:trPr><w:tblHeader/></w:trPr>')
    + row([cell(p([r('{[list Beneficiaries]}'), r('{[Name]}')])), cell(p([r('{[Share]}%'), r('{[end list]}')], '<w:jc w:val="right"/>'))])
    + row([cell(tp('Total')), cell(tp('{[sum(Beneficiaries, "Share")]}%', '<w:jc w:val="right"/>'))])
    + '</w:tbl>',
  tp(''),
  tp('{[if HasPets]}'),
  '<w:tbl>' + TBL_HEAD + row([cell(tp('Pet')), cell(tp('{[Pet.Name]}'))]) + '</w:tbl>',
  tp('{[end if]}'),
  p([r('{[if not IsMarried]}'), r('Single-line optional paragraph.'), r('{[end if]}')]),
  p([r('{[list Notes]}'), r('{[_item]}'), r('{[_punc]}'), r('{[end list]}')], '<w:jc w:val="center"/>'),
  tp('Signed.'),
].join('');

const DATA = {
  IsMarried: true,
  Spouse: { FullName: 'Bo Lee', Pronoun: 'female' },
  Children: [
    { Name: 'Kim', IsMinor: true, DOB: '2012-03-14' },
    { Name: 'Lee', IsMinor: false, DOB: '2001-11-02' },
    { Name: 'Cy', IsMinor: true, DOB: '2016-07-09' },
  ],
  Beneficiaries: [{ Name: 'Kim', Share: 50 }, { Name: 'Lee', Share: 30 }, { Name: 'Cy', Share: 20 }],
  HasPets: false,
  Notes: [],
};

let bytes, out, xml, text;
test('will fixture fills without warnings', async () => {
  bytes = await makeDocx({ 'word/document.xml': docXml(WILL) }, { name: 'will' });
  out = await fillDocx(bytes, DATA);
  writeFileSync(OUT + '/will-filled.docx', out.bytes);
  assert.deepEqual(out.warnings, []);
  xml = await readZipText(out.bytes, 'word/document.xml');
  ({ text } = await readDocx(out.bytes));
  assert.ok(!xml.includes('{['), 'no tags remain');
  assert.deepEqual(await checkDocx(OUT + '/will-filled.docx'), []);
});

test('paragraph-level if/else: taken branch keeps its paragraphs, marker paragraphs vanish', () => {
  assert.ok(text.includes('I am married to **Bo Lee**, and all references to my spouse are to her.'), text);
  assert.ok(!text.includes('I am not married.'));
  assert.ok(!text.includes('drafter note'));
  assert.ok(xml.includes('<w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t xml:space="preserve">I am married to </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Bo Lee</w:t></w:r>'));
});

test('inline list with _punc inside a numbered paragraph keeps numPr', () => {
  assert.ok(text.includes('1. My children are Kim, Lee, and Cy.'), text);
  assert.ok(xml.includes(`<w:pPr>${NUM}</w:pPr><w:r><w:t xml:space="preserve">My children are </w:t></w:r>`));
});

test('paragraph-level list repeats the paragraph per item with nested inline if', () => {
  const lines = text.split('\n');
  // blocksToText escapes a literal "1." at line start so it is not mistaken for a numbered list.
  assert.ok(lines.includes('\t\\1. *Kim* (a minor) — born March 14, 2012'), text);
  assert.ok(lines.includes('\t\\2. *Lee* — born November 2, 2001'), text);
  assert.ok(lines.includes('\t\\3. *Cy* (a minor) — born July 9, 2016'), text);
  assert.equal((xml.match(/<w:pPr><w:ind w:left="720"\/><\/w:pPr>/g) || []).length, 3, 'pPr copied to every repetition');
});

test('Knackly table row {[list X]} … {[end list]} repeats the row; header and total rows are untouched', () => {
  const rows = xml.match(/<w:tr [^>]*>[\s\S]*?<\/w:tr>/g);
  assert.equal(rows.length, 5); // header + 3 beneficiaries + total  (the pets table is gone)
  assert.ok(rows[0].includes('<w:trPr><w:tblHeader/></w:trPr>'));
  assert.ok(rows[1].includes('>Kim<') && rows[1].includes('>50<'));
  assert.ok(rows[3].includes('>Cy<') && rows[3].includes('>20<'));
  assert.ok(rows[4].includes('>Total<') && rows[4].includes('>100<'));
  assert.ok(xml.includes(TBL_HEAD), 'tblPr / tblGrid byte-identical');
  assert.equal((xml.match(/<w:tcPr><w:tcW w:w="4675" w:type="dxa"\/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"\/><\/w:tcPr>/g) || []).length, 10);
  assert.ok(rows[1].includes('<w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t xml:space="preserve">50</w:t></w:r><w:r><w:t xml:space="preserve">%</w:t></w:r>'));
});

test('a paragraph-level if wrapping a whole table removes the table', () => {
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 1);
  assert.ok(!xml.includes('Pet'));
});

test('paragraph fully wrapped by an inline block that renders empty is removed', () => {
  assert.ok(!xml.includes('Single-line optional paragraph.'));
  assert.ok(!xml.includes('<w:pPr><w:jc w:val="center"/></w:pPr>'), 'empty {[list Notes]} paragraph dropped');
  assert.ok(xml.includes('Signed.'));
});

test('the false branch: married paragraphs go, single paragraph stays, pets table appears', async () => {
  const res = await fillDocx(bytes, { ...DATA, IsMarried: false, HasPets: true, Pet: { Name: 'Rex' }, Notes: ['alpha', 'beta'] });
  const t = (await readDocx(res.bytes)).text;
  assert.ok(t.includes('I am not married.'));
  assert.ok(!t.includes('I am married to'));
  assert.ok(t.includes('Single-line optional paragraph.'));
  assert.ok(t.includes('|Pet|Rex|'), t);
  assert.ok(t.includes('>center alpha and beta'), t);
  assert.deepEqual(res.warnings, []);
});

test('textutil renders the filled will', () => {
  const tu = textutil(OUT + '/will-filled.docx');
  if (tu == null) return;
  assert.ok(tu.includes('I am married to Bo Lee, and all references to my spouse are to her.'), tu);
  assert.ok(tu.includes('My children are Kim, Lee, and Cy.'), tu);
  assert.ok(tu.includes('Kim\t50%') || tu.includes('Kim 50%') || /Kim\s+50%/.test(tu), tu);
  assert.ok(!tu.includes('Pet'));
});

test('extractTemplateText of the will compiles and yields the expected variables', async () => {
  const t = await extractTemplateText(bytes);
  const { errors, analysis } = compile(t);
  assert.deepEqual(errors, []);
  for (const v of ['IsMarried', 'Spouse.FullName', 'Children', 'Children[].Name', 'Children[].IsMinor', 'Beneficiaries[].Share', 'HasPets', 'Pet.Name']) assert.ok(analysis.variables.has(v), v);
});

test('marker rows: {[if]} / {[list]} rows alone in a table', () => {
  const tbl = '<w:tbl>' + TBL_HEAD
    + row([cell(tp('{[list Items]}')), cell(tp(''))])
    + row([cell(tp('{[Name]}')), cell(tp('{[Qty]}'))])
    + row([cell(tp('{[end list]}')), cell(tp(''))])
    + row([cell(tp('{[if ShowTotal]}')), cell(tp(''))])
    + row([cell(tp('Total')), cell(tp('{[sum(Items, "Qty")]}'))])
    + row([cell(tp('{[end if]}')), cell(tp(''))])
    + '</w:tbl>';
  const res = fillPartXml(docXml(tbl + tp('')), { Items: [{ Name: 'a', Qty: 1 }, { Name: 'b', Qty: 2 }], ShowTotal: false });
  assert.deepEqual(res.warnings, []);
  const rows = res.xml.match(/<w:tr [^>]*>[\s\S]*?<\/w:tr>/g);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes('>a<') && rows[1].includes('>b<'));
  assert.ok(!res.xml.includes('Total'));
});

test('a table whose only rows are removed disappears; an emptied cell keeps a paragraph', () => {
  const tbl = '<w:tbl>' + TBL_HEAD + row([cell(tp('{[list Nothing]}') + tp('{[Name]}') + tp('{[end list]}')), cell(tp('x'))]) + '</w:tbl>';
  const res = fillPartXml(docXml(tbl + tp('after')), { Nothing: [] });
  assert.ok(res.xml.includes('<w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:tcPr><w:p/></w:tc>'));
  const gone = fillPartXml(docXml('<w:tbl>' + TBL_HEAD + row([cell(tp('{[list Nothing]}{[Name]}')), cell(tp('{[x]}{[end list]}'))]) + '</w:tbl>' + tp('after')), { Nothing: [], x: 1 });
  assert.ok(!gone.xml.includes('<w:tbl>'));
  assert.ok(gone.xml.includes('after'));
});

test('a body whose paragraphs are all removed still gets an empty paragraph before sectPr', () => {
  const res = fillPartXml(docXml(tp('{[if No]}') + tp('gone') + tp('{[end if]}')), { No: false });
  assert.ok(res.xml.includes('<w:body><w:p/><w:sectPr>'));
});

test('unbalanced paragraph-level blocks warn and leave the tags as text; fields still fill', () => {
  const res = fillPartXml(docXml(tp('{[if A]}') + tp('Name: {[Name]}') + tp('{[end list]}')), { A: true, Name: 'Zed' });
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /\{\[end list\]\} closes an \{\[if\]\}/);
  assert.ok(res.xml.includes('{[if A]}') && res.xml.includes('{[end list]}'));
  assert.ok(res.xml.includes('>Zed<'));
});

test('inline block that is not closed in its paragraph warns and stays as text', () => {
  const res = fillPartXml(docXml(tp('Start {[if A]} middle') + tp('end {[end if]} {[Name]}')), { A: true, Name: 'Zed' });
  assert.equal(res.warnings.length, 2);
  assert.match(res.warnings[0], /has no matching \{\[end if\]\} in paragraph "Start \{\[if A\]\} middle"/);
  assert.match(res.warnings[1], /\{\[end if\]\} has no matching \{\[if\]\} in paragraph/);
  assert.ok(res.xml.includes('{[if A]}') && res.xml.includes('{[end if]}') && res.xml.includes('>Zed<'));
});

test('nested list inside list with elseif chains at paragraph level', () => {
  const body = tp('{[list Trusts]}') + tp('Trust {[Name]}:') + tp('{[list Beneficiaries]}') + tp('- {[Name]} gets {[Share]}%{[if Share >= 50]} (majority){[else if Share >= 25]} (quarter+){[else]} (minor){[end if]}') + tp('{[end list]}') + tp('{[end list]}');
  const res = fillPartXml(docXml(body), { Trusts: [{ Name: 'T1', Beneficiaries: [{ Name: 'a', Share: 60 }, { Name: 'b', Share: 30 }, { Name: 'c', Share: 10 }] }, { Name: 'T2', Beneficiaries: [{ Name: 'd', Share: 100 }] }] });
  assert.deepEqual(res.warnings, []);
  const texts = [...res.xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(texts, ['Trust T1:', '- a gets 60% (majority)', '- b gets 30% (quarter+)', '- c gets 10% (minor)', 'Trust T2:', '- d gets 100% (majority)']);
});

test('missing list renders nothing (like render()); render options (yes/no, model) are honoured', () => {
  const res = fillPartXml(docXml(tp('{[list Nobody]}') + tp('{[Name]}') + tp('{[end list]}') + tp('{[Flag]} {[Code]}')), { Flag: true, Code: '2026-01-02' }, { yes: 'Sí', model: { variables: { Code: { type: 'text' } } } });
  assert.deepEqual(res.warnings, []);
  assert.ok(!res.xml.includes('{[') && !res.xml.includes('>Name<'));
  assert.ok(res.xml.includes('>Sí<'));
  assert.ok(res.xml.includes('>2026-01-02<'), 'text-typed variable is not auto-formatted as a date');
});

test('a docx produced by our own buildDocx from a sample template fills like assemble()', async () => {
  const sample = samples.find((s) => s.id === 'engagement-letter');
  // Multi-line comments become several paragraphs in a .docx (a tag cannot span paragraphs) — drop them first.
  const src = tokenize(sample.text).filter((t) => !(t.type === 'field' && t.value.startsWith('#'))).map((t) => (t.type === 'field' ? `{[${t.value}]}` : t.value)).join('').replace(/^\n+/, '');
  const docx = await buildDocx(textToBlocks(src), { title: sample.name });
  const res = await fillDocx(docx, sample.sampleAnswers);
  writeFileSync(OUT + '/engagement-filled.docx', res.bytes);
  const expected = assemble(src, sample.sampleAnswers);
  assert.deepEqual(res.warnings, expected.warnings);
  const got = (await readDocx(res.bytes)).text;
  assert.ok(!got.includes('{['));
  // Every non-blank rendered line of the text engine appears in the filled document (modulo markdown decoration).
  const strip = (s) => s.replace(/^>\w+ /, '').replace(/[*_]/g, '').replace(/^\s*(?:\d+\.|[-*])\s+/, '').trim();
  const gotLines = new Set(got.split('\n').map(strip));
  for (const line of expected.text.split('\n').map(strip).filter(Boolean)) assert.ok(gotLines.has(line), 'missing line: ' + line);
  assert.deepEqual(await checkDocx(OUT + '/engagement-filled.docx'), []);
});
