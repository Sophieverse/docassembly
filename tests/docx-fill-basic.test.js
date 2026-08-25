import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fillDocx, extractTemplateText, fillPartXml, partTemplateText, hasTagText } from '../engine/docx/fill.js';
import { readDocx } from '../engine/docx/docxread.js';
import { readZip, readZipText } from '../engine/docx/zipread.js';
import { compile } from '../engine/index.js';
import { makeDocx, docXml, hdrXml, ftrXml, p, r, tp, OUT, checkDocx, textutil } from './docx-fill-fixtures.js';

const dec = new TextDecoder();
async function part(bytes, name) { return readZipText(bytes, name); }

// A document.xml the way Word writes it: split runs, proofErr, rsid attributes, a bold tag start, smart quotes.
const TITLE = p([r('LAST WILL OF ', '<w:b/><w:caps/>'), r('{[', '<w:b/>', ' w:rsidRPr="00AB12CD"'), '<w:proofErr w:type="spellStart"/>', r('Client.', '', ' w:rsidR="001122AA"'), r('FullName', '', ' w:rsidR="00C0FFEE"'), '<w:proofErr w:type="spellEnd"/>', r(']}')], '<w:pStyle w:val="Title"/><w:jc w:val="center"/>');
const INTRO = p([r('I, '), r('{[Client.FullName]}', '<w:b/>'), r(', of '), r('{[Client.City]}'), r(', declare this to be my Will, signed '), r('{[SigningDate|format:“legal”]}'), r('.')], '<w:jc w:val="both"/><w:spacing w:after="240"/>');
const PLAIN = p([r('This paragraph has no tags and elaborate formatting.', '<w:rFonts w:ascii="Courier New"/><w:i/><w:color w:val="FF0000"/><w:sz w:val="20"/>')], '<w:ind w:left="720" w:hanging="360"/><w:spacing w:line="360" w:lineRule="auto"/>');
const NOTES = p([r('Notes: '), r('{[Notes]}')]);
const MISSING = p([r('Executor: '), r('{[Executor.Name]}'), r(' (end)')]);
const BOOL = p([r('Married: {[IsMarried]}. Fee: {[Fee|currency]}. Amp: {[Firm]}')]);
const HYPER = p([r('See '), '<w:hyperlink r:id="rId99" w:history="1">', r('{[Client.', '<w:u w:val="single"/>'), r('Site]}', '<w:u w:val="single"/>'), '</w:hyperlink>', r(' for details.')]);
const BODY = TITLE + INTRO + PLAIN + NOTES + MISSING + BOOL + HYPER;

const HEADER = hdrXml(p([r('Will of '), r('{['), r('Client.FullName'), r(']}')], '<w:pStyle w:val="Header"/><w:jc w:val="right"/>'));
const FOOTER = ftrXml(p([r('Page '), '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>'], '<w:jc w:val="center"/>'));

const DATA = {
  Client: { FullName: 'Ann <Lee> & Co', City: 'Berkeley', Site: 'annlee.example' },
  SigningDate: '2026-03-05',
  Notes: 'line one\nline two\tafter tab',
  IsMarried: true,
  Fee: 1500,
  Firm: 'Lee & Sons',
};

let bytes, out;
test('fixture builds and fills', async () => {
  bytes = await makeDocx({ 'word/document.xml': docXml(BODY), 'word/header1.xml': HEADER, 'word/footer1.xml': FOOTER }, { name: 'basic' });
  out = await fillDocx(bytes, DATA);
  assert.ok(out.bytes instanceof Uint8Array);
  writeFileSync(OUT + '/basic-filled.docx', out.bytes);
  assert.deepEqual(out.warnings, ['Missing value: Executor.Name']);
});

test('output zip and every XML part are well-formed (unzip -t, xmllint)', async () => {
  assert.deepEqual(await checkDocx(OUT + '/basic-filled.docx'), []);
  const zip = readZip(out.bytes);
  assert.equal([...zip.keys()][0], '[Content_Types].xml');
  assert.deepEqual([...zip.keys()].sort(), [...readZip(bytes).keys()].sort());
});

test('tags split across runs / proofErr / rsid are consolidated into one run with the starting run formatting', async () => {
  const xml = await part(out.bytes, 'word/document.xml');
  assert.ok(!xml.includes('{['), 'no tags left');
  // The title tag started in a bold run with an rsid attribute: the value run keeps both.
  assert.match(xml, /<w:r w:rsidRPr="00AB12CD"><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Ann &lt;Lee&gt; &amp; Co<\/w:t><\/w:r>/);
  // Split-run leftovers are gone, proofErr markers are kept.
  assert.ok(!xml.includes('<w:t xml:space="preserve">Client.</w:t>'));
  assert.ok(xml.includes('<w:proofErr w:type="spellStart"/>'));
  // Smart quotes inside the tag were normalized so the filter argument parsed.
  assert.ok(xml.includes('the 5th day of March, 2026'));
  // Bold inline field keeps bold.
  assert.ok(xml.includes('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Ann &lt;Lee&gt; &amp; Co</w:t></w:r>'));
  // Booleans / currency / xml escaping.
  assert.ok(xml.includes('<w:t xml:space="preserve">Lee &amp; Sons</w:t>'));
  assert.ok((await readDocx(out.bytes)).text.includes('Married: Yes. Fee: $1,500.00. Amp: Lee & Sons'));
});

test('newlines become w:br and tabs w:tab', async () => {
  const xml = await part(out.bytes, 'word/document.xml');
  assert.ok(xml.includes('<w:t xml:space="preserve">line one</w:t><w:br/><w:t xml:space="preserve">line two</w:t><w:tab/><w:t xml:space="preserve">after tab</w:t>'));
});

test('a tag inside a hyperlink is filled and the hyperlink element survives', async () => {
  const xml = await part(out.bytes, 'word/document.xml');
  assert.match(xml, /<w:hyperlink r:id="rId99" w:history="1"><w:r><w:rPr><w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">annlee\.example<\/w:t><\/w:r><\/w:hyperlink>/);
});

test('formatting XML outside modified runs is byte-identical', async () => {
  const xml = await part(out.bytes, 'word/document.xml');
  assert.ok(xml.includes(PLAIN), 'untouched paragraph is emitted verbatim');
  assert.ok(xml.includes('<w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr>'));
  assert.ok(xml.includes('<w:pPr><w:jc w:val="both"/><w:spacing w:after="240"/></w:pPr>'));
  assert.ok(xml.includes('<w:r><w:rPr><w:b/><w:caps/></w:rPr><w:t xml:space="preserve">LAST WILL OF </w:t></w:r>'));
  assert.ok(xml.includes('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'));
  const styles = await part(out.bytes, 'word/styles.xml');
  assert.equal(styles, await part(bytes, 'word/styles.xml'));
  assert.equal(await part(out.bytes, 'word/numbering.xml'), await part(bytes, 'word/numbering.xml'));
  assert.equal(await part(out.bytes, '[Content_Types].xml'), await part(bytes, '[Content_Types].xml'));
});

test('header tags are filled; a footer without tags is left byte-identical', async () => {
  const hdr = await part(out.bytes, 'word/header1.xml');
  assert.ok(hdr.includes('<w:t xml:space="preserve">Will of </w:t></w:r><w:r><w:t xml:space="preserve">Ann &lt;Lee&gt; &amp; Co</w:t></w:r>'));
  assert.ok(hdr.includes('<w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>'));
  assert.equal(await part(out.bytes, 'word/footer1.xml'), FOOTER);
});

test('missing value renders empty, keeps neighbours, warns once', async () => {
  const xml = await part(out.bytes, 'word/document.xml');
  assert.ok(xml.includes('<w:t xml:space="preserve">Executor: </w:t></w:r><w:r><w:t xml:space="preserve"> (end)</w:t>'));
});

test('readDocx text of the result and textutil agree with the expected prose', async () => {
  const { text } = await readDocx(out.bytes);
  assert.equal(out.text, text);
  assert.ok(text.includes('I, **Ann <Lee> & Co**, of Berkeley, declare this to be my Will, signed the 5th day of March, 2026.'), text);
  const tu = textutil(OUT + '/basic-filled.docx');
  if (tu != null) {
    assert.ok(tu.includes('LAST WILL OF Ann <Lee> & Co'), tu);
    assert.ok(tu.includes('line two\tafter tab'), tu);
    assert.ok(tu.includes('See annlee.example for details.'));
  }
});

test('a document without tags comes back with every part identical', async () => {
  const plain = await makeDocx({ 'word/document.xml': docXml(PLAIN + tp('Nothing to fill here.')) }, { name: 'notags' });
  const res = await fillDocx(plain, { Anything: 1 });
  assert.deepEqual(res.warnings, []);
  const a = readZip(plain), b = readZip(res.bytes);
  for (const [name, e] of a) assert.equal(dec.decode(await b.get(name).bytes()), dec.decode(await e.bytes()), name);
});

test('extractTemplateText: headers first, then body, then footers; bold-split tags reassembled; compiles', async () => {
  const text = await extractTemplateText(bytes);
  const lines = text.split('\n');
  assert.equal(lines[0], 'Will of {[Client.FullName]}');
  assert.equal(lines[1], 'LAST WILL OF {[Client.FullName]}');
  assert.ok(lines.includes('I, {[Client.FullName]}, of {[Client.City]}, declare this to be my Will, signed {[SigningDate|format:"legal"]}.'));
  assert.ok(!text.includes('Page '), 'tag-less footer skipped');
  const { errors, analysis } = compile(text);
  assert.deepEqual(errors, []);
  assert.ok(analysis.variables.has('Client.FullName'));
  assert.ok(analysis.variables.has('Executor.Name'));
});

test('unterminated / malformed tags are left as text with a warning; bad expressions too', () => {
  const xml = docXml(p([r('Open {[Name and no close')]) + p([r('Bad {[Name +]} here')]) + p([r('ok {[Name]}')]));
  const res = fillPartXml(xml, { Name: 'Zed' });
  assert.ok(res.xml.includes('Open {[Name and no close'));
  assert.ok(res.xml.includes('>Bad </w:t></w:r><w:r><w:t xml:space="preserve">{[Name +]}</w:t></w:r><w:r><w:t xml:space="preserve"> here<'));
  assert.ok(res.xml.includes('ok </w:t></w:r><w:r><w:t xml:space="preserve">Zed</w:t>'));
  assert.equal(res.warnings.length, 2);
  assert.match(res.warnings[0], /Unterminated field/);
  assert.match(res.warnings[1], /Bad expression in \{\[Name \+\]\}/);
});

test('hasTagText sees "{" and "[" split into separate runs; partTemplateText joins them', () => {
  const xml = docXml(p([r('{'), r('['), r('X'), r(']'), r('}')]));
  assert.ok(hasTagText(xml));
  assert.equal(partTemplateText(xml), '{[X]}');
  assert.ok(fillPartXml(xml, { X: 'joined' }).xml.includes('>joined<'));
});

test('w:del runs are ignored; w:ins runs are filled', () => {
  const xml = docXml(p(['<w:del w:id="1" w:author="a"><w:r><w:delText>{[Gone]}</w:delText></w:r></w:del>', '<w:ins w:id="2" w:author="a">' + r('{[Kept]}') + '</w:ins>']));
  const res = fillPartXml(xml, { Gone: 'NO', Kept: 'yes' });
  assert.ok(res.xml.includes('<w:delText>{[Gone]}</w:delText>'));
  assert.ok(res.xml.includes('<w:ins w:id="2" w:author="a"><w:r><w:t xml:space="preserve">yes</w:t></w:r></w:ins>'));
  assert.deepEqual(res.warnings, []);
});

test('text boxes (mc:AlternateContent → w:txbxContent) and run-level content controls are filled', () => {
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="x" xmlns:v="y"';
  const inner = tp('{[if A]}') + tp('box {[X]}') + tp('{[end if]}');
  const box = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${inner}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>${r('host {[H]}')}</w:p>`;
  const sdt = `<w:p><w:sdt><w:sdtPr><w:alias w:val="n"/></w:sdtPr><w:sdtContent>${r('{[Y]}')}</w:sdtContent></w:sdt></w:p>`;
  const xml = `<w:document ${NS}><w:body>${box}${sdt}<w:sectPr/></w:body></w:document>`;
  const on = fillPartXml(xml, { A: true, X: 'inbox', H: 'outer', Y: 'ctl' });
  assert.deepEqual(on.warnings, []);
  assert.equal((on.xml.match(/<w:txbxContent><w:p><w:r><w:t xml:space="preserve">box <\/w:t><\/w:r><w:r><w:t xml:space="preserve">inbox<\/w:t><\/w:r><\/w:p><\/w:txbxContent>/g) || []).length, 2, 'Choice and Fallback both filled');
  assert.ok(on.xml.includes('>host </w:t></w:r><w:r><w:t xml:space="preserve">outer</w:t>'));
  assert.ok(on.xml.includes('<w:sdt><w:sdtPr><w:alias w:val="n"/></w:sdtPr><w:sdtContent><w:r><w:t xml:space="preserve">ctl</w:t></w:r></w:sdtContent></w:sdt>'));
  const off = fillPartXml(xml, { A: false, H: 'outer', Y: 'ctl' });
  assert.equal((off.xml.match(/<w:txbxContent><w:p\/><\/w:txbxContent>/g) || []).length, 2, 'emptied text box keeps a paragraph');
  assert.equal(partTemplateText(xml).split('\n')[0], 'host {[H]}');
});

test('rejects non-docx input', async () => {
  await assert.rejects(fillDocx(new Uint8Array([1, 2, 3]), {}), /not a \.docx/);
});
