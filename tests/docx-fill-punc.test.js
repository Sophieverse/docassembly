// Inline {[list X|punc:"1, 2, and 3"]} auto-punctuation in .docx fills (mirrors engine-punc-auto.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fillDocx, fillPartXml } from '../engine/docx/fill.js';
import { readDocx } from '../engine/docx/docxread.js';
import { makeDocx, docXml, p, r, tp, OUT, checkDocx, textutil } from './docx-fill-fixtures.js';

const kids = (n) => ({ Children: [{ Name: 'Maya' }, { Name: 'Leo' }, { Name: 'Ann' }].slice(0, n) });
const PUNC = '{[list Children|punc:"1, 2, and 3"]}{[Name]}{[endlist]}';

async function fillText(xml, data, name) {
  const bytes = await makeDocx({ 'word/document.xml': docXml(xml) }, { name });
  const res = await fillDocx(bytes, data);
  const out = join(OUT, name + '-filled.docx');
  writeFileSync(out, res.bytes);
  assert.deepEqual(await checkDocx(out), []);
  const tu = textutil(out);
  const text = (tu != null ? tu : readDocx(res.bytes).text).replace(/\r?\n+$/, '');
  return { text, xml: new TextDecoder().decode(res.bytes.length ? res.bytes : new Uint8Array()), res };
}

test('inline |punc list appends separators after each item (3, 2, 1 items)', async () => {
  const xml = tp('Kids: ' + PUNC + '.');
  assert.equal((await fillText(xml, kids(3), 'punc3')).text, 'Kids: Maya, Leo, and Ann.');
  assert.equal((await fillText(xml, kids(2), 'punc2')).text, 'Kids: Maya and Leo.');
  assert.equal((await fillText(xml, kids(1), 'punc1')).text, 'Kids: Maya.');
});

test('explicit {[_punc]} in the body is not doubled', async () => {
  const xml = tp('{[list Children|punc:"1; 2; or 3"]}{[Name]}{[_punc]}{[end list]}');
  assert.equal((await fillText(xml, kids(3), 'punc-explicit')).text, 'Maya; Leo; or Ann');
});

test('list without |punc does not auto-punctuate', async () => {
  const xml = tp('{[list Children]}{[Name]} {[end list]}');
  assert.equal((await fillText(xml, kids(3), 'punc-none')).text, 'Maya Leo Ann ');
});

test('separator takes the formatting of the run it follows (bold list tag → bold separator)', () => {
  const xml = docXml(p([r('Kids: '), r(PUNC, '<w:b/>'), r('.')]));
  const res = fillPartXml(xml, kids(3));
  assert.deepEqual(res.warnings, []);
  const runs = [...res.xml.matchAll(/<w:r>(<w:rPr>.*?<\/w:rPr>)?<w:t xml:space="preserve">([^<]*)<\/w:t><\/w:r>/g)].map((m) => [m[1] || '', m[2]]);
  assert.deepEqual(runs, [
    ['', 'Kids: '],
    ['<w:rPr><w:b/></w:rPr>', 'Maya'], ['<w:rPr><w:b/></w:rPr>', ', '],
    ['<w:rPr><w:b/></w:rPr>', 'Leo'], ['<w:rPr><w:b/></w:rPr>', ', and '],
    ['<w:rPr><w:b/></w:rPr>', 'Ann'],
    ['', '.'],
  ]);
});

test('separator follows the formatting of the last run in the item body, not the list tag', () => {
  const xml = docXml(p([r('{[list Children|punc:"1, 2 and 3"]}'), r('{[Name]}', '<w:i/>'), r('{[end list]}')]));
  const res = fillPartXml(xml, kids(2));
  assert.deepEqual(res.warnings, []);
  assert.ok(res.xml.includes('<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Maya</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> and </w:t></w:r>'), res.xml);
});

test('paragraph-level |punc list repeats paragraphs without separators', () => {
  const xml = docXml(tp('{[list Children|punc:"1, 2, and 3"]}') + tp('{[Name]}') + tp('{[end list]}'));
  const res = fillPartXml(xml, kids(3));
  const texts = [...res.xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  assert.deepEqual(texts, ['Maya', 'Leo', 'Ann']);
});
