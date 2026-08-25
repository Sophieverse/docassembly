const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();
  const report = c.report;
  await c.goto(URL + '#/templates');
  const tid = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); return Object.values(s.templates).find(t => t.name.includes('Last Will')).id; })()`);
  // Create record from sample answers, but make Relationship/Alternate non-empty so validate passes; re-open interview with record
  const rid = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const t = Object.values(s.templates).find(t => t.name.includes('Last Will')); const d = JSON.parse(JSON.stringify(t.sampleAnswers)); d.SpecificGifts[1].Relationship = 'friend'; d.SpecificGifts[1].Alternate = 'Clara Vance'; const id = 'rec_qa1'; s.records[id] = { id, name: 'Vance, Eleanor — Will', data: d, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; localStorage.setItem('docassembly.v1', JSON.stringify(s)); return id; })()`);
  await c.goto(URL + '#/interview/' + tid + '?record=' + rid); await c.wait(600); report('interview w/ record');
  console.log('record label:', await c.eval('document.querySelector(".record-bar strong").textContent'), 'progress:', await c.eval('document.querySelector(".progress span.small").textContent'));
  console.log('preview has spouse:', await c.eval('document.querySelector(".interview-side").textContent.includes("Thomas Reid Vance")'));
  await c.eval(`document.querySelector('.sticky-actions button[type=submit]').click(); true`); await c.wait(1200);
  console.log('hash after generate:', await c.eval('location.hash'));
  console.log('errSummary:', await c.eval('(document.querySelector(".interview-form .errors") || {textContent:"NONE"}).textContent.slice(0, 300)'));
  report('generate');
  const out = await c.eval('document.querySelector(".doc-host") ? document.querySelector(".doc-host").textContent : "NO DOC"');
  console.log('output has ARTICLE I / spouse:', out.includes('ARTICLE I'), out.includes('I am married to Thomas Reid Vance'), 'guardian article:', out.includes('GUARDIAN OF MINOR'), 'warnings:', await c.eval('(document.querySelector(".warn-list")||{textContent:"none"}).textContent.slice(0,200)'));
  await c.shot('08-output.png');
  // Intercept download
  await c.eval(`window.__blobs = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); }; HTMLAnchorElement.prototype.click = function() { window.__clicked = (window.__clicked||0)+1; }; true`);
  await c.eval(`[...document.querySelectorAll('.output-side button')].find(b => b.textContent.includes('Download')).click(); true`); await c.wait(1500);
  report('download click');
  const info = await c.eval(`(async () => { const b = window.__blobs[0]; if (!b) return 'NO BLOB'; const bytes = new Uint8Array(await b.arrayBuffer()); const m = await import('./engine/docx/docxread.js'); const r = await m.readDocx(bytes); return { size: b.size, type: b.type, clicked: window.__clicked, hasSpouse: r.text.includes('Thomas Reid Vance'), textStart: r.text.slice(0, 120) }; })()`);
  console.log('docx:', JSON.stringify(info));
  // Print: intercept window.open
  await c.eval(`window.__opened = null; window.open = () => { const d = { html: '', write(s) { this.html += s; }, close() {}, print() { window.__printed = true; } }; window.__opened = { document: d, focus() {}, print() { window.__printed = true; } }; return window.__opened; }; true`);
  await c.eval(`[...document.querySelectorAll('.output-side button')].find(b => b.textContent.includes('Print')).click(); true`); await c.wait(600);
  console.log('print:', await c.eval('window.__opened ? { len: window.__opened.document.html.length, hasSpouse: window.__opened.document.html.includes("Thomas Reid Vance"), printed: !!window.__printed } : "not opened"'));
  report('print');
  // Records page
  await c.goto(URL + '#/records'); await c.wait(500); report('records list');
  console.log('records:', await c.eval('[...document.querySelectorAll("table.list tbody tr")].map(tr => tr.querySelector(".name").textContent + " / " + tr.children[1].textContent)'));
  await c.shot('09-records.png');
  // Open engagement letter with ?record=
  const eid = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); return Object.values(s.templates).find(t => t.name.includes('Engagement')).id; })()`);
  // add Client.FullName to the record via record editor form
  await c.goto(URL + '#/records/' + rid); await c.wait(600); report('record editor');
  console.log('record form groups:', await c.eval('[...document.querySelectorAll(".panel-body > div > .q")].map(n => n.dataset.path + ":" + n.dataset.type).slice(0, 40)'));
  const hasClient = await c.eval('!!document.querySelector(".q[data-path=Client]")');
  console.log('has Client group:', hasClient);
  await c.eval(`(() => { const i = document.querySelector('.q[data-path="Client"] .q[data-path="FullName"] input'); i.value = 'Eleanor Marie Vance'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
  await c.eval(`(() => { const i = document.querySelector('.q[data-path="Testator"] .q[data-path="County"] textarea, .q[data-path="Testator"] .q[data-path="County"] input'); i.value = 'Hays'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent === 'Save').click(); true`); await c.wait(400);
  report('record edit+save');
  console.log('stored county:', await c.eval(`JSON.parse(localStorage.getItem('docassembly.v1')).records['${rid}'].data.Testator.County`), 'client:', await c.eval(`JSON.parse(localStorage.getItem('docassembly.v1')).records['${rid}'].data.Client?.FullName`));
  // Export JSON (intercept)
  await c.eval(`window.__blobs = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); }; HTMLAnchorElement.prototype.click = function() {}; true`);
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent === 'Export').click(); true`); await c.wait(300);
  const exported = await c.eval(`(async () => { const b = window.__blobs[0]; return b ? await b.text() : null; })()`);
  console.log('export ok:', !!exported && JSON.parse(exported).data.Testator.County === 'Hays');
  require('fs').writeFileSync(outFile('record-export.json'), exported);
  // Import it back on records page via file input interception
  await c.goto(URL + '#/records'); await c.wait(400);
  await c.eval(`(() => { const o = HTMLInputElement.prototype.click; window.__fileInput = null; HTMLInputElement.prototype.click = function() { if (this.type === 'file') { window.__fileInput = this; } else o.call(this); }; return true; })()`);
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent === 'Import JSON').click(); true`); await c.wait(200);
  const { root } = await c.send('DOM.getDocument', { depth: 0 });
  const nodeId = (await c.send('Runtime.evaluate', { expression: 'window.__fileInput' })).result.objectId;
  const { nodeId: nid } = await c.send('DOM.requestNode', { objectId: nodeId });
  await c.send('DOM.setFileInputFiles', { files: [outFile('record-export.json')], nodeId: nid });
  await c.wait(1200); report('import record');
  console.log('records after import:', await c.eval('[...document.querySelectorAll("table.list tbody tr")].map(tr => tr.querySelector(".name").textContent)'));
  // Engagement letter interview with record: shared Client fields prefilled
  await c.goto(URL + '#/interview/' + eid + '?record=' + rid); await c.wait(700); report('engagement interview');
  console.log('client name prefilled:', await c.eval(`(document.querySelector('.q[data-path="Client"] .q[data-path="FullName"] input') || {value:'NO FIELD'}).value`));
  console.log('progress:', await c.eval('document.querySelector(".progress span.small").textContent'));
  await c.shot('10-engagement-prefilled.png');
  console.log('dialogs:', c.dialogs, 'LOGS:', c.logs);
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
