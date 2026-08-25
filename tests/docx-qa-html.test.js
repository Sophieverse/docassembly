// QA: blocksToHtml — XSS escaping and HTML validity (xmllint --html).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { textToBlocks } from '../engine/docx/blocks.js';
import { blocksToHtml, safeFont } from '../engine/docx/html.js';
import { samples } from '../samples/index.js';
import { assemble } from '../engine/index.js';

const OUT = '/private/tmp/claude-501/-Users-melod/3d0f23c6-a481-4b3b-a0b2-43cc231b3f85/scratchpad/docx-qa-out';
mkdirSync(OUT, { recursive: true });
function has(cmd) { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } }

function bodyOnly(html) { return html.replace(/<style>[\s\S]*?<\/style>/, ''); }

test('html: script tags, event handlers and attribute breakouts in template text are escaped everywhere', () => {
  const evil = '<script>alert(1)</script> <img src=x onerror="alert(2)"> "><svg/onload=alert(3)> javascript:alert(4) &lt;b&gt;';
  const text = [`# ${evil}`, `>title ${evil}`, `>center ${evil}`, `**${evil}** *${evil}* __${evil}__`, `1. ${evil}`, `- ${evil}`, `  - ${evil}`, `|${evil}|${evil}|`, `|x|${evil}|`, `\t${evil}`].join('\n');
  const html = blocksToHtml(textToBlocks(text), { title: evil, font: evil, fontSize: 12 });
  const body = bodyOnly(html);
  assert.ok(!/<script/i.test(html), 'no <script');
  assert.ok(!/<img/i.test(html) && !/<svg/i.test(html), 'no injected tags');
  // every real tag is ours: user text can never produce a '<' (it is always '&lt;'), so inspect real tags only
  for (const tag of html.match(/<[a-zA-Z\/][^>]*>/g)) {
    assert.ok(!/\son\w+\s*=/i.test(tag), 'live event handler in ' + tag);
    assert.ok(!/javascript:/i.test(tag), 'javascript: in ' + tag);
  }
  assert.ok(html.includes('onerror=&quot;alert(2)&quot;'), 'the attribute text is present but escaped');
  assert.equal((body.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g) || []).length, 14, 'each occurrence escaped (10 lines, 3 inline runs + 2 extra cells)');
  assert.ok(body.includes('&amp;lt;b&amp;gt;'), 'pre-escaped entities are double-escaped, not decoded');
  assert.ok(html.includes(`<title>&lt;script&gt;`), 'title escaped');
  assert.ok(!html.includes('<style>' + '') || !/<style>[\s\S]*<script/.test(html), 'font name cannot break out of <style>');
});

test('html: font name is sanitized before it is interpolated into <style>; bad numeric opts fall back', () => {
  assert.equal(safeFont('Times New Roman'), 'Times New Roman');
  assert.equal(safeFont('Garamond-Light 2'), 'Garamond-Light 2');
  assert.equal(safeFont('</style><script>alert(1)</script>'), 'stylescriptalert1script');
  assert.equal(safeFont('x; } body { display:none } .a {'), 'x  body  displaynone  a');
  assert.equal(safeFont(''), 'Times New Roman');
  assert.equal(safeFont(null), 'Times New Roman');
  const html = blocksToHtml(textToBlocks('x'), { font: '"; } </style><script>alert(1)</script>', fontSize: 'NaN', margins: { top: 'x' }, lineSpacing: null });
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('font-family: "stylescriptalert1script", "Times New Roman"'), html.match(/font-family[^;]*/)[0]);
  assert.ok(html.includes('font-size: 12pt') && html.includes('margin: 1in 1in 1in 1in'), 'numeric fallbacks');
  assert.ok(!/NaN|undefined|null/.test(html));
});

test('html: nested lists, tables, page breaks and every sample produce well-formed HTML (xmllint --html)', (t) => {
  const text = ['1. one', '  a. one-a', '    i. one-a-i', '  b. one-b', '2. two', '- b1', '  - b2', '    - b3', '- b4', '1. after', '', '2. blank inside list', 'Para', '|a|b|', '|c|d|', '---', '>right r'].join('\n');
  const docs = [['nested', blocksToHtml(textToBlocks(text), { title: 'nested' })]];
  for (const s of samples) docs.push([s.id, blocksToHtml(textToBlocks(assemble(s.text, s.sampleAnswers).text), { title: s.name })]);
  const nested = docs[0][1];
  // structural expectations for the nested list: ol > li > ol > li > ol ; ul nesting 3 deep ; blank paragraph inside list is a no-op
  assert.match(nested, /<ol><li><p>one<\/p><ol><li><p>one-a<\/p><ol><li><p>one-a-i<\/p><\/li><\/ol><\/li><li><p>one-b<\/p><\/li><\/ol><\/li><li><p>two<\/p><\/li><\/ol><ul><li><p>b1<\/p><ul><li><p>b2<\/p><ul><li><p>b3<\/p><\/li><\/ul><\/li><\/ul><\/li><li><p>b4<\/p><\/li><\/ul><ol><li><p>after<\/p><\/li><li><p>blank inside list<\/p><\/li><\/ol><p>Para<\/p><table>/);
  assert.match(nested, /<div class="pagebreak"><\/div><p class="al-right">r<\/p>/);
  // balanced tags
  for (const [id, html] of docs) {
    for (const tag of ['ol', 'ul', 'li', 'table', 'tr', 'td', 'p', 'div', 'strong', 'em', 'u', 'h1', 'h2', 'h3']) {
      const open = (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length, close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(open, close, `${id}: <${tag}> balance`);
    }
  }
  if (!has('xmllint')) return t.skip('xmllint not available');
  for (const [id, html] of docs) {
    const f = `${OUT}/html-${id}.html`;
    writeFileSync(f, html);
    // xmllint --html reports structural errors ("Opening and ending tag mismatch", "Unexpected end tag") on stderr
    let err = '';
    try { execFileSync('xmllint', ['--html', '--noout', f], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }); } catch (e) { err = String(e.stderr); }
    assert.ok(!/mismatch|Unexpected end tag|not allowed|misplaced/.test(err), `${id}: ${err.slice(0, 500)}`);
    // xmllint --html tolerates a lot; also check strict XML well-formedness of the body fragment
    const frag = blocksToHtml(textToBlocks(id === 'nested' ? text : assemble(samples.find((s) => s.id === id).text, samples.find((s) => s.id === id).sampleAnswers).text), { fragment: true });
    writeFileSync(`${OUT}/frag-${id}.xml`, frag.replace(/<br>/g, '<br/>').replace(/&nbsp;/g, ' '));
    execFileSync('xmllint', ['--noout', `${OUT}/frag-${id}.xml`], { stdio: 'pipe' });
  }
});
