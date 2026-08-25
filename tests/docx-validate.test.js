import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { textToBlocks } from '../engine/docx/blocks.js';
import { buildDocx, buildDocxSync } from '../engine/docx/docxwrite.js';

const OUT = '/private/tmp/claude-501/-Users-melod/3d0f23c6-a481-4b3b-a0b2-43cc231b3f85/scratchpad/docx-test-out';
mkdirSync(OUT, { recursive: true });
const TEXT = ['>title Validation Doc', '# Heading', 'Body **bold** text with {[Field]}.', '1. one', '2. two', '- bullet', '|a|b|', '|c|d|', '---', 'Last page.'].join('\n');

function has(cmd) { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } }

for (const [label, make] of [['deflate', () => buildDocx(textToBlocks(TEXT), { title: 'V' })], ['store', () => buildDocxSync(textToBlocks(TEXT), { title: 'V' })]]) {
  test(`unzip -t validates the ${label} docx`, async (t) => {
    if (!has('unzip')) return t.skip('unzip not available');
    const file = `${OUT}/validate-${label}.docx`;
    writeFileSync(file, await make());
    const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.match(out, /No errors detected/);
    assert.match(out, /testing: word\/document\.xml\s+OK/);
  });

  test(`textutil converts the ${label} docx (macOS)`, async (t) => {
    if (process.platform !== 'darwin' || !has('textutil')) return t.skip('textutil not available');
    const file = `${OUT}/validate-${label}.docx`;
    if (!existsSync(file)) writeFileSync(file, await make());
    const txt = `${OUT}/validate-${label}.txt`;
    execFileSync('textutil', ['-convert', 'txt', '-output', txt, file]);
    const s = readFileSync(txt, 'utf8');
    for (const needle of ['Validation Doc', 'Heading', 'Body bold text with {[Field]}.', 'one', 'two', 'bullet', 'Last page.']) assert.ok(s.includes(needle), 'missing: ' + needle);
  });
}
