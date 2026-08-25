import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textToBlocks } from '../engine/docx/blocks.js';
import { blocksToHtml } from '../engine/docx/html.js';

test('blocksToHtml sanity', () => {
  const blocks = textToBlocks([
    '>title Agreement <1>', '# Heading & more', '>center **Bold** *it* __u__', '\tTabbed', '',
    '1. one', '2. two', '  a. sub', '3. three', '- b1', '  - b2', 'plain',
    '|h1|h2|', '|c1|c2|', '---', 'end',
  ].join('\n'));
  const html = blocksToHtml(blocks, { title: 'T', font: 'Arial', fontSize: 11 });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>T<\/title>/);
  assert.match(html, /font-family: "Arial"/);
  assert.match(html, /font-size: 11pt/);
  assert.match(html, /<h1 class="title">Agreement &lt;1&gt;<\/h1>/);
  assert.match(html, /<h1>Heading &amp; more<\/h1>/);
  assert.match(html, /<p class="al-center"><strong>Bold<\/strong> <em>it<\/em> <u>u<\/u><\/p>/);
  assert.match(html, /margin-left:0\.5in/);
  assert.match(html, /<p>&nbsp;<\/p>/);
  assert.match(html, /<ol><li><p>one<\/p><\/li><li><p>two<\/p><ol><li><p>sub<\/p><\/li><\/ol><\/li><li><p>three<\/p><\/li><\/ol>/);
  assert.match(html, /<ul><li><p>b1<\/p><ul><li><p>b2<\/p><\/li><\/ul><\/li><\/ul><p>plain<\/p>/);
  assert.match(html, /<table><tr><td><p>h1<\/p><\/td><td><p>h2<\/p><\/td><\/tr><tr><td><p>c1<\/p><\/td><td><p>c2<\/p><\/td><\/tr><\/table>/);
  assert.match(html, /<div class="pagebreak"><\/div><p>end<\/p>/);
  assert.match(html, /page-break-after: always/);
  assert.ok(!html.includes('<script'));
  const frag = blocksToHtml(blocks, { fragment: true });
  assert.ok(frag.startsWith('<div class="doc">') && !frag.includes('<html'));
});

test('html escapes attacker-ish text', () => {
  const html = blocksToHtml(textToBlocks('<script>alert(1)</script> "q"'), { fragment: true });
  assert.equal(html, '<div class="doc"><p>&lt;script&gt;alert(1)&lt;/script&gt; &quot;q&quot;</p></div>');
});
