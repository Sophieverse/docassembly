// QA: Word-realism of INPUT. Hand-built packages mimicking real Word output (rsids, proofErr, bookmarks, split runs,
// smart quotes, hyperlinks, content controls, gridSpan, multi-level numbering, headers/footers, drawings, footnotes,
// smartTags), docx produced by Apple's textutil from HTML and RTF, and files that are not docx at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { readDocx, parseDocumentXml, parseXml } from '../engine/docx/docxread.js';
import { writeZip } from '../engine/docx/zipwrite.js';
import { textToBlocks, blocksToText } from '../engine/docx/blocks.js';

const OUT = '/private/tmp/claude-501/-Users-melod/3d0f23c6-a481-4b3b-a0b2-43cc231b3f85/scratchpad/docx-qa-out';
mkdirSync(OUT, { recursive: true });
function has(cmd) { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } }
const HAS_TEXTUTIL = process.platform === 'darwin' && has('textutil');

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"';

const R = (t, rsid = '00A1B2C3', rPr = '') => `<w:r w:rsidRPr="${rsid}" w:rsidR="${rsid}">${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;

// A document.xml the way Word 365 writes it.
const WORD_DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>
<w:p w14:paraId="1A2B3C4D" w:rsidR="00AB12CD" w:rsidRDefault="00AB12CD" w:rsidP="00AB12CD"><w:pPr><w:pStyle w:val="Ttulo"/><w:rPr><w:lang w:val="en-US"/></w:rPr></w:pPr><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>${R('Engagement Letter')}</w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:proofErr w:type="spellStart"/>${R('Client')}<w:proofErr w:type="spellEnd"/>${R(' Information')}</w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${R('Sub')}</w:p>
<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr>${R('Sub-sub')}</w:p>
<w:p w:rsidR="00111111"><w:pPr><w:rPr><w:b/></w:rPr></w:pPr>${R('Dear ')}<w:proofErr w:type="gramStart"/>${R('{[', '00222222')}${R('Client.FullName', '00333333')}<w:proofErr w:type="gramEnd"/>${R(']}', '00444444')}${R(',')}</w:p>
<w:p>${R('{[if IsMarried]}')}${R('Your spouse ')}${R('{[Spouse.Name]}', '00555555', '<w:b/><w:bCs/>')}${R(' born ')}${R('{[Spouse.DOB|format:“long”]}', '00666666')}${R('{[end if]}')}${R(' And a “real” quote outside.')}</w:p>
<w:p><w:r><w:lastRenderedPageBreak/><w:t>After a rendered page break (not a real one)</w:t></w:r></w:p>
<w:p>${R('See ')}<w:hyperlink r:id="rId5" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>our website</w:t></w:r></w:hyperlink>${R(' for details.')}</w:p>
<w:p>${R('Content control: ')}<w:sdt><w:sdtPr><w:alias w:val="Name"/><w:tag w:val="name"/><w:id w:val="12345"/><w:placeholder><w:docPart w:val="DefaultPlaceholder"/></w:placeholder></w:sdtPr><w:sdtContent>${R('{[Client.City]}', '00777777')}</w:sdtContent></w:sdt>${R('.')}</w:p>
<w:sdt><w:sdtPr><w:id w:val="99"/></w:sdtPr><w:sdtContent><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${R('Block-level content control heading')}</w:p></w:sdtContent></w:sdt>
<w:p>${R('Smart tag: ')}<w:smartTag w:uri="urn:schemas-microsoft-com:office:smarttags" w:element="place">${R('Chicago')}</w:smartTag>${R(', Illinois')}</w:p>
<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>${R('Level zero')}</w:p>
<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr></w:pPr>${R('Level one')}</w:p>
<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="2"/><w:numId w:val="3"/></w:numPr></w:pPr>${R('Level two')}</w:p>
<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${R('A bullet')}</w:p>
<w:p><w:pPr><w:ind w:left="1440"/></w:pPr>${R('Indented twice via w:ind')}</w:p>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${R('Centered', '00888888', '<w:i/><w:u w:val="single"/>')}</w:p>
<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${R('Justified')}</w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
<w:tr w:rsidR="00999999"><w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr><w:p>${R('Spans two')}</w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${R('{[B.Share]}%')}</w:p></w:tc></w:tr>
<w:tr><w:tc><w:p>${R('r2c1')}</w:p><w:p>${R('second para')}</w:p></w:tc><w:tc><w:p>${R('r2c2')}</w:p></w:tc><w:tc><w:p/></w:tc></w:tr>
</w:tbl>
<w:p>${R('Image: ')}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>${R(' after image')}</w:p>
<w:p>${R('Footnote')}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>${R(' text continues.')}</w:p>
<w:p><w:ins w:id="5" w:author="A" w:date="2026-01-01T00:00:00Z">${R('inserted ')}</w:ins><w:del w:id="6" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>deleted </w:delText></w:r></w:del>${R('kept')}</w:p>
<w:p><w:r><w:t>Before break</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>Same paragraph after break</w:t></w:r></w:p>
<w:p><w:pPr><w:pageBreakBefore/></w:pPr>${R('Page break before')}</w:p>
<mc:AlternateContent><mc:Choice Requires="w14"><w:p>${R('Choice content')}</w:p></mc:Choice><mc:Fallback><w:p>${R('Fallback content')}</w:p></mc:Fallback></mc:AlternateContent>
<w:p><w:r><w:t>Tab</w:t><w:tab/><w:t>separated</w:t><w:sym w:font="Wingdings" w:char="F0FC"/><w:t xml:space="preserve"> and </w:t><w:noBreakHyphen/><w:t>hyphen &amp; &lt;entities&gt; &#169; &#x2014;</w:t></w:r></w:p>
<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId8"/><w:footerReference w:type="default" r:id="rId9"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>
<w:sectPr><w:headerReference w:type="default" r:id="rId8"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Ttulo"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>
<w:abstractNum w:abstractNumId="0" w15:restartNumberingAfterBreak="0" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w:nsid w:val="1F2E3D4C"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="A1B2C3D4"/>
<w:lvl w:ilvl="0" w:tplc="0409000F"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1" w:tplc="04090019"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
<w:lvl w:ilvl="2" w:tplc="0409001B"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:lvlJc w:val="right"/><w:pPr><w:ind w:left="2160" w:hanging="180"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:nsid w:val="2F2E3D4C"/><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:lvlJc w:val="left"/><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:r><w:t>HEADER TEXT MUST NOT APPEAR</w:t></w:r></w:p></w:hdr>`;
const FOOTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:r><w:t>FOOTER TEXT MUST NOT APPEAR</w:t></w:r></w:p></w:ftr>`;
const FOOTNOTES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${NS}><w:footnote w:id="1"><w:p><w:r><w:t>FOOTNOTE BODY MUST NOT APPEAR</w:t></w:r></w:p></w:footnote></w:footnotes>`;

function wordPackage(overrides = {}) {
  const entries = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': WORD_DOC,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`,
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
    'word/header1.xml': HEADER,
    'word/footer1.xml': FOOTER,
    'word/footnotes.xml': FOOTNOTES,
    'word/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    ...overrides,
  };
  return writeZip(Object.entries(entries).filter(([, v]) => v != null).map(([name, data]) => ({ name, data })));
}

test('input: a Word-365-style package imports with text, structure and placeholders intact', async () => {
  const bytes = wordPackage();
  writeFileSync(`${OUT}/word-realistic.docx`, bytes);
  const { text, blocks } = await readDocx(bytes);
  const paras = blocks.filter((b) => b.type === 'paragraph');
  const byText = (needle) => paras.find((p) => p.runs.map((r) => r.text).join('').includes(needle));

  assert.equal(blocks[0].style, 'Title', 'Title resolved through styles.xml name (localized styleId)');
  assert.equal(blocks[0].runs[0].text, 'Engagement Letter');
  assert.deepEqual(blocks[1], { type: 'paragraph', runs: [{ text: 'Client Information' }], style: 'Heading1', align: 'left' }, 'proofErr does not split runs');
  assert.equal(blocks[2].style, 'Heading2'); assert.equal(blocks[3].style, 'Heading3');

  assert.deepEqual(blocks[4].runs, [{ text: 'Dear {[Client.FullName]},' }], 'placeholder split across 3 rsid runs reassembles');
  const cond = blocks[5];
  assert.equal(cond.runs.map((r) => r.text).join(''), '{[if IsMarried]}Your spouse {[Spouse.Name]} born {[Spouse.DOB|format:"long"]}{[end if]} And a “real” quote outside.');
  assert.deepEqual(cond.runs[1], { text: '{[Spouse.Name]}', bold: true }, 'bold run inside field kept');

  assert.ok(byText('After a rendered page break'), 'lastRenderedPageBreak is not a page break');
  assert.ok(!blocks.slice(0, 8).some((b) => b.type === 'pagebreak'));
  assert.deepEqual(byText('our website').runs, [{ text: 'See our website for details.' }], 'hyperlink text inlined');
  assert.deepEqual(byText('Content control').runs, [{ text: 'Content control: {[Client.City]}.' }], 'run-level sdt');
  assert.equal(byText('Block-level content control').style, 'Heading2', 'block-level sdt paragraphs surface with their style');
  assert.deepEqual(byText('Smart tag').runs, [{ text: 'Smart tag: Chicago, Illinois' }]);

  const nums = paras.filter((p) => p.numbering);
  assert.deepEqual(nums.map((p) => [p.numbering.kind, p.numbering.level, p.runs[0].text]), [['decimal', 0, 'Level zero'], ['decimal', 1, 'Level one'], ['decimal', 2, 'Level two'], ['bullet', 0, 'A bullet']]);
  assert.equal(byText('Indented twice').indent, 2);
  assert.deepEqual(byText('Centered'), { type: 'paragraph', runs: [{ text: 'Centered', italic: true, underline: true }], style: 'Normal', align: 'center' });
  assert.equal(byText('Justified').align, 'justify');

  const table = blocks.find((b) => b.type === 'table');
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].length, 2, 'gridSpan cell counts once');
  assert.equal(table.rows[0][1][0].runs[0].text, '{[B.Share]}%');
  assert.equal(table.rows[1].length, 3);
  assert.equal(table.rows[1][0].length, 2, 'two paragraphs in a cell');
  assert.deepEqual(table.rows[1][2], [{ type: 'paragraph', runs: [], style: 'Normal', align: 'left' }], 'empty cell');

  assert.deepEqual(byText('Image').runs, [{ text: 'Image:  after image' }], 'drawing ignored gracefully');
  assert.deepEqual(byText('Footnote').runs, [{ text: 'Footnote text continues.' }], 'footnote reference ignored');
  assert.deepEqual(byText('kept').runs, [{ text: 'inserted kept' }], 'tracked insert kept, delete dropped');

  const i = blocks.findIndex((b) => b.type === 'paragraph' && b.runs[0]?.text === 'Before breakSame paragraph after break');
  assert.ok(i > 0 && blocks[i - 1].type === 'pagebreak', 'in-paragraph page break becomes a pagebreak block before the paragraph');
  const j = blocks.findIndex((b) => b.type === 'paragraph' && b.runs[0]?.text === 'Page break before');
  assert.ok(j > 0 && blocks[j - 1].type === 'pagebreak', 'w:pageBreakBefore becomes a pagebreak block');
  assert.ok(byText('Fallback content') && !byText('Choice content'), 'mc:AlternateContent: Fallback (we understand no Requires namespace), never both');
  assert.deepEqual(byText('Tab').runs, [{ text: 'Tab\tseparated and ‑hyphen & <entities> © —' }]);

  assert.ok(!text.includes('HEADER') && !text.includes('FOOTER') && !text.includes('FOOTNOTE BODY'), 'headers/footers/footnotes ignored');
  assert.ok(!text.includes('Hyperlink') && !text.includes('_GoBack'));
  // the trailing section-break paragraph is not content
  assert.deepEqual(blocks[blocks.length - 1].runs.map((r) => r.text), ['Tab\tseparated\uF0FC and ‑hyphen & <entities> © —']);
  // a mid-document section break is a page break (unless continuous)
  const mid = parseDocumentXml('<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p><w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>c</w:t></w:r></w:p></w:body></w:document>');
  assert.deepEqual(mid.map((b) => b.type === 'pagebreak' ? '---' : b.runs[0].text), ['a', '---', 'b', 'c']);

  // the imported text is editable template text: it re-parses to the same blocks, except that multi-paragraph table
  // cells flatten to one paragraph (documented lossy case: the text model has one line per table row)
  const flat = blocks.map((b) => b.type !== 'table' ? b : { ...b, rows: b.rows.map((r) => r.map((cell) => [{ type: 'paragraph', runs: cell.length ? [{ text: cell.map((p) => p.runs.map((x) => x.text).join('')).join(' ').trim() }].filter((x) => x.text) : [], style: 'Normal', align: 'left' }])) });
  assert.deepEqual(textToBlocks(text), flat);
  assert.equal(blocksToText(textToBlocks(text)), text, 'text is a fixed point');
  assert.ok(text.includes('{[Spouse.DOB|format:"long"]}'), 'straight quotes in the editable text');
});

test('input: numbering kinds fall back sensibly when numbering.xml is missing or the numId is unknown', () => {
  const xml = `<w:document xmlns:w="x"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>not a list</w:t></w:r></w:p></w:body></w:document>`;
  const blocks = parseDocumentXml(xml, null, null);
  assert.deepEqual(blocks[0].numbering, { kind: 'bullet', level: 1 });
  assert.equal(blocks[1].numbering, undefined, 'numId 0 removes numbering');
});

test('input: files that are not a .docx throw a clear error quickly (no hang)', async () => {
  const cases = [
    ['random bytes', new Uint8Array(Array.from({ length: 4096 }, (_, i) => (i * 7919) & 0xff)), /not a \.docx/],
    ['empty file', new Uint8Array(0), /not a \.docx/],
    ['legacy .doc (OLE)', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(600).fill(0)]), /legacy binary Word file/],
    ['plain text', new TextEncoder().encode('This is just a text file pretending to be a docx.\n'.repeat(50)), /not a \.docx/],
    ['zip without document.xml', writeZip([{ name: 'hello.txt', data: 'hi' }]), /document\.xml missing/],
    ['truncated docx', wordPackage().subarray(0, 700), /not a \.docx/],
    ['EOCD only', new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]), /not a \.docx|document\.xml/],
    ['central dir offset past EOF', (() => { const z = wordPackage(); const b = new Uint8Array(z); const e = b.length - 22; b[e + 16] = 0xff; b[e + 17] = 0xff; b[e + 18] = 0xff; b[e + 19] = 0x7f; return b; })(), /not a \.docx/],
  ];
  for (const [label, bytes, re] of cases) {
    const t0 = performance.now();
    await assert.rejects(readDocx(bytes), re, label);
    assert.ok(performance.now() - t0 < 500, label + ' was slow');
  }
});

test('input: a corrupt document.xml (unterminated constructs, garbage) never hangs readDocx', async () => {
  for (const doc of ['<w:document><w:body><w:p><!-- never closed', '<?xml version="1.0"?><w:document><w:body><![CDATA[oops', '<!DOCTYPE broken', '<w:document><w:body><w:p><w:r><w:t>text</w:t', '']) {
    const bytes = wordPackage({ 'word/document.xml': doc });
    const t0 = performance.now();
    await readDocx(bytes).then(() => {}, () => {});
    assert.ok(performance.now() - t0 < 500, 'hang on: ' + doc);
  }
});

const HTML_FIXTURE = `<html><head><meta charset="utf-8"></head><body>
<h1>Heading One</h1><h2>Heading Two</h2><h3>Heading Three</h3>
<p><b>bold</b> <i>italic</i> <u>underline</u> and <b><i>both</i></b></p>
<ol><li>first</li><li>second<ol><li>sub a</li><li>sub b</li></ol></li><li>third</li></ol>
<ul><li>bullet<ul><li>nested bullet</li></ul></li></ul>
<table border="1"><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>
<p style="text-align:center">Centered para</p>
<p>Before break</p><br style="page-break-before:always"><p>After break</p>
<p>Tab&#9;separated&#9;text</p>
<p>{[Client.FullName]} and {[if IsMarried]}spouse{[end if]} {[Amount|format:“currency”]}</p>
</body></html>`;

test('input: docx written by Apple textutil from HTML imports (Apple bakes formatting in directly)', async (t) => {
  if (!HAS_TEXTUTIL) return t.skip('textutil not available');
  writeFileSync(`${OUT}/in.html`, HTML_FIXTURE);
  execFileSync('textutil', ['-convert', 'docx', '-output', `${OUT}/in-html.docx`, `${OUT}/in.html`]);
  const { text, blocks } = await readDocx(new Uint8Array(readFileSync(`${OUT}/in-html.docx`)));
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 3), ['**Heading One**', '**Heading Two**', '**Heading Three**'], 'Apple writes headings as direct bold, no styles');
  assert.equal(lines[3], '**bold** *italic* __underline__ and ***both***');
  assert.ok(lines.some((l) => /first$/.test(l)) && lines.some((l) => /sub a$/.test(l)), 'list item text present (Apple emits numbers as literal text)');
  // Apple's HTML→docx converter does not write w:tbl at all (cells become paragraphs); nothing to do but keep the text
  for (const cell of ['A1', 'B1', 'A2', 'B2']) assert.ok(lines.includes(cell), 'cell text kept: ' + cell);
  assert.ok(lines.includes('>center Centered para'));
  assert.ok(lines.includes('Before break') && lines.includes('After break'));
  assert.ok(/Tab[\t ]separated[\t ]text/.test(text), 'Apple turns &#9; into spaces; either is fine');
  assert.ok(text.includes('{[Client.FullName]} and {[if IsMarried]}spouse{[end if]} {[Amount|format:"currency"]}'), 'placeholders intact, smart quotes fixed');
  assert.deepEqual(textToBlocks(text), blocks, 'imported text re-parses to the same blocks');
});

test('input: docx written by Apple textutil from RTF imports', async (t) => {
  if (!HAS_TEXTUTIL) return t.skip('textutil not available');
  const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times New Roman;}}
\pard\qc\b\fs32 Centered Bold Title\b0\fs24\par
\pard Plain paragraph with \b bold\b0 , \i italic\i0  and \ul underline\ulnone .\par
\pard\tab Tabbed line\par
\pard \{[Client.FullName]\} owes \{[Amount|format:"currency"]\}\par
\page After page break\par
}`;
  writeFileSync(`${OUT}/in.rtf`, rtf);
  execFileSync('textutil', ['-convert', 'docx', '-output', `${OUT}/in-rtf.docx`, `${OUT}/in.rtf`]);
  const { text, blocks } = await readDocx(new Uint8Array(readFileSync(`${OUT}/in-rtf.docx`)));
  assert.equal(blocks[0].align, 'center');
  assert.deepEqual(blocks[0].runs, [{ text: 'Centered Bold Title', bold: true }]);
  assert.ok(text.includes('Plain paragraph with **bold**, *italic* and __underline__.'), text);
  assert.ok(text.includes('{[Client.FullName]} owes {[Amount|format:"currency"]}'));
  assert.ok(blocks.some((b) => b.type === 'pagebreak'), 'RTF \\page becomes a pagebreak block');
  assert.ok(text.includes('After page break'));
  assert.deepEqual(textToBlocks(text), blocks);
});

test('input: parseXml handles Word namespace soup, CDATA, entities, attributes with single quotes and > inside values', () => {
  const root = parseXml(`<?xml version="1.0"?><!DOCTYPE x><a x='1' y="a>b" z="&amp;&#65;&#x42;"><!-- c --><b/><![CDATA[<raw>&amp;]]>t&lt;&gt;</a>`);
  const a = root.children[0];
  assert.deepEqual(a.attrs, { x: '1', y: 'a>b', z: '&AB' });
  assert.deepEqual(a.children.map((c) => c.name === '#text' ? c.text : c.name), ['b', '<raw>&amp;', 't<>']);
});
