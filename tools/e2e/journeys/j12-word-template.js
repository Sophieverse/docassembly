// Word-template mode: download the generated example .docx, import it with "Keep as Word template", run the
// interview, generate, and verify the downloaded .docx has the answers and the original styling (Title style).
const { connect, URL, outFile, done } = require('../lib.js');
const fs = require('fs'); const path = require('path');
(async () => {
  const c = await connect();
  await c.goto(URL + '#/templates'); await c.wait(300);
  if (!(await c.eval('(() => { try { return Object.keys(JSON.parse(localStorage.getItem("docassembly.v1")).templates).length > 0; } catch (e) { return false; } })()'))) await c.seed();
  // Capture downloads as blobs
  const hookDownloads = () => c.eval(`window.__blobs = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); }; HTMLAnchorElement.prototype.click = function() { window.__clicked = (window.__clicked||0)+1; }; true`);
  await hookDownloads();
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent.includes('Example Word template')).click(); true`); await c.wait(1200);
  const example = await c.eval(`(async () => { const b = window.__blobs[0]; if (!b) return null; const bytes = new Uint8Array(await b.arrayBuffer()); const m = await import('./engine/docx/docxread.js'); const r = await m.readDocx(bytes); return { size: b.size, b64: btoa(String.fromCharCode(...bytes)), tags: (r.text.match(/\\{\\[/g) || []).length, title: r.blocks.find(x => x.style === 'Title') ? r.blocks.find(x => x.style === 'Title').runs.map(r => r.text).join('') : null }; })()`);
  console.log('example docx:', example && { size: example.size, tags: example.tags, title: example.title });
  if (!example || !example.tags) console.log('ERR example Word template not generated');
  const file = outFile('example-word-template.docx');
  fs.writeFileSync(file, Buffer.from(example.b64, 'base64'));
  c.report('example download');
  // Import as Word template
  await c.goto(URL + '#/templates'); await c.wait(400);
  await c.eval(`(() => { const o = HTMLInputElement.prototype.click; window.__fileInput = null; HTMLInputElement.prototype.click = function() { if (this.type === 'file') { window.__fileInput = this; } else o.call(this); }; return true; })()`);
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent === 'Import .docx').click(); true`); await c.wait(200);
  await c.send('DOM.getDocument', { depth: 0 });
  const objectId = (await c.send('Runtime.evaluate', { expression: 'window.__fileInput' })).result.objectId;
  const { nodeId } = await c.send('DOM.requestNode', { objectId });
  await c.send('DOM.setFileInputFiles', { files: [file], nodeId }); await c.wait(600);
  console.log('import mode modal:', await c.eval('[...document.querySelectorAll(".modal .import-mode strong")].map(b => b.textContent)'));
  await c.eval(`[...document.querySelectorAll('.modal .import-mode')].find(b => b.textContent.includes('Keep as Word')).click(); true`); await c.wait(1200);
  const tid = await c.eval('location.hash.split("/").pop()');
  const stored = await c.eval(`(() => { const t = JSON.parse(localStorage.getItem('docassembly.v1')).templates['${tid}']; return t ? { name: t.name, docxName: t.docxName, originLen: (t.docxOrigin || '').length, vars: Object.keys(t.model.variables).length, textTags: (t.text.match(/\\{\\[/g) || []).length } : null; })()`);
  console.log('stored word template:', JSON.stringify(stored));
  if (!stored || !stored.originLen || !stored.vars) console.log('ERR Word template not stored with bytes + model');
  console.log('editor: readonly', await c.eval('document.querySelector(".editor-textarea").readOnly'), 'banner:', await c.eval('(document.querySelector(".word-banner") || {}).textContent.slice(0, 60)'), 'toolbar disabled:', await c.eval('[...document.querySelectorAll(".editor-toolbar button")].every(b => b.disabled)'));
  await c.eval(`document.querySelector('.tabs button[data-tab=preview]').click(); true`); await c.wait(400);
  console.log('preview labelled text preview:', await c.eval('!![...document.querySelectorAll(".tab-body .badge")].find(b => /Text preview/.test(b.textContent))'));
  await c.shot('27-word-editor.png');
  c.report('import as Word template');
  await c.eval('window.onbeforeunload = null; true');
  // Interview with a record
  const rid = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const id = 'rec_e2e_word'; const now = new Date().toISOString(); s.records[id] = { id, name: 'Word test', data: { Client: { FullName: 'Jordan Rivera', IsEntity: false, IsMarried: true, Gender: 'Nonbinary' }, SigningDate: '2026-08-24', Children: [{ Name: 'Maya Rivera', DOB: '2012-03-14' }, { Name: 'Leo Rivera', DOB: '2016-11-02' }], Fee: 1250.5, Attorney: { Name: 'alex chen' } }, createdAt: now, updatedAt: now }; localStorage.setItem('docassembly.v1', JSON.stringify(s)); return id; })()`);
  await c.goto(URL + '#/interview/' + tid + '?record=' + rid); await c.wait(800);
  console.log('interview questions:', await c.eval('document.querySelectorAll(".interview-form .q").length'), 'first label:', await c.eval('document.querySelector(".interview-form .q label").textContent'));
  await c.eval(`document.querySelector('.interview-form button[type=submit]').click(); true`); await c.wait(1500);
  console.log('hash:', await c.eval('location.hash'), 'word badge on output:', await c.eval('!![...document.querySelectorAll(".badge")].find(b => b.textContent === "Word template")'), 'preview has name:', await c.eval('document.querySelector(".doc-host").textContent.includes("Jordan Rivera")'), 'warnings:', await c.eval('(document.querySelector(".output-side .warn-list") || {}).textContent || "none"'));
  c.report('generate');
  await hookDownloads();
  await c.eval(`[...document.querySelectorAll('.output-side button')].find(b => b.textContent.includes('Download')).click(); true`); await c.wait(1200);
  const out = await c.eval(`(async () => { const b = window.__blobs[0]; if (!b) return null; const bytes = new Uint8Array(await b.arrayBuffer()); const m = await import('./engine/docx/docxread.js'); const r = await m.readDocx(bytes); return { size: b.size, type: b.type, hasName: r.text.includes('JORDAN RIVERA') && r.text.includes('Jordan Rivera'), hasChildren: r.text.includes('Maya Rivera') && r.text.includes('Leo Rivera'), fee: r.text.includes('$1,250.50'), noTags: !r.text.includes('{['), titleBlock: (r.blocks.find(x => x.style === 'Title') || { runs: [] }).runs.map(r => r.text).join(''), styles: [...new Set(r.blocks.map(b => b.style).filter(Boolean))], start: r.text.slice(0, 160) }; })()`);
  console.log('filled docx:', JSON.stringify(out));
  if (!out || !out.hasName || !out.hasChildren || !out.noTags) console.log('ERR filled .docx missing answers or still has tags');
  if (!out || !/Jordan Rivera/.test(out.titleBlock)) console.log('ERR Title style not preserved in filled .docx');
  await c.shot('28-word-output.png');
  c.report('download filled docx');
  // Replace Word file: same bytes again → still works, name updated
  await c.goto(URL + '#/templates/' + tid); await c.wait(700);
  await c.eval(`(() => { const o = HTMLInputElement.prototype.click; window.__fileInput = null; HTMLInputElement.prototype.click = function() { if (this.type === 'file') { window.__fileInput = this; } else o.call(this); }; return true; })()`);
  await c.eval(`[...document.querySelectorAll('.word-banner button')].find(b => b.textContent === 'Replace Word file').click(); true`); await c.wait(200);
  await c.send('DOM.getDocument', { depth: 0 });
  const oid2 = (await c.send('Runtime.evaluate', { expression: 'window.__fileInput' })).result.objectId;
  const { nodeId: nid2 } = await c.send('DOM.requestNode', { objectId: oid2 });
  await c.send('DOM.setFileInputFiles', { files: [file], nodeId: nid2 }); await c.wait(1500);
  console.log('after replace: status', await c.eval('document.querySelector(".editor-status").textContent'), 'toasts:', await c.eval('[...document.querySelectorAll(".toast")].map(t => t.textContent)'));
  c.report('replace Word file');
  await c.eval('window.onbeforeunload = null; true');
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
