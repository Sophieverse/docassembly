const { connect, URL, fixture, outFile, done } = require('../lib.js');
const lum = (rgb) => { const c = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return ((x + 0.05) / (y + 0.05)).toFixed(2); };
(async () => {
  const c = await connect();
  const report = c.report;
  await c.goto(URL + '#/settings'); await c.wait(400); report('settings');
  await c.shot('14-settings-light.png');
  // theme toggle
  await c.click('#theme-toggle'); await c.wait(300);
  console.log('theme attr:', await c.eval('document.documentElement.getAttribute("data-theme")'), 'stored:', await c.eval('JSON.parse(localStorage.getItem("docassembly.v1")).settings.theme'));
  const sample = async () => c.eval(`(() => { const bg = getComputedStyle(document.body).backgroundColor; const out = {}; const pick = (sel, name) => { const n = document.querySelector(sel); if (!n) { out[name] = 'missing'; return; } const cs = getComputedStyle(n); let el = n, b = cs.backgroundColor; while (el && (b === 'rgba(0, 0, 0, 0)' || b === 'transparent')) { el = el.parentElement; b = el ? getComputedStyle(el).backgroundColor : bg; } out[name] = [cs.color, b]; }; pick('body', 'body'); pick('.muted', 'muted'); pick('.card h3', 'h3'); pick('.topnav a', 'nav'); pick('.topnav a.active', 'navActive'); pick('label', 'label'); pick('input[type=text]', 'input'); pick('.btn', 'btn'); pick('.btn-primary', 'btnPrimary'); pick('.badge', 'badge'); pick('.help, .card p.muted', 'help'); return out; })()`);
  const dark = await sample();
  for (const [k, v] of Object.entries(dark)) console.log('dark', k, v, v !== 'missing' ? contrast(v[0], v[1]) : '');
  await c.shot('15-settings-dark.png');
  // dark interview + editor screens for visual check
  const ids = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const f = (n) => Object.values(s.templates).find(t => t.name.includes(n)).id; return { will: f('Last Will') }; })()`);
  await c.goto(URL + '#/interview/' + ids.will + '?record=rec_qa1'); await c.wait(800);
  const darkI = await c.eval(`(() => { const out = {}; const pick = (sel, name) => { const n = document.querySelector(sel); if (!n) { out[name] = 'missing'; return; } const cs = getComputedStyle(n); let el = n, b = cs.backgroundColor; while (el && (b === 'rgba(0, 0, 0, 0)' || b === 'transparent')) { el = el.parentElement; b = el ? getComputedStyle(el).backgroundColor : 'rgb(255,255,255)'; } out[name] = [cs.color, b]; }; pick('.progress .small', 'progressText'); pick('.record-bar .label', 'recordLabel'); pick('.list-item-head', 'listHead'); pick('.q-group legend', 'legend'); pick('.help', 'help'); pick('.segmented button', 'segBtn'); pick('.segmented button.on', 'segOn'); pick('.sticky-actions .muted', 'stickyMuted'); pick('.doc p', 'docP'); return out; })()`);
  for (const [k, v] of Object.entries(darkI)) console.log('dark-interview', k, v, v !== 'missing' ? contrast(v[0], v[1]) : '');
  await c.shot('16-interview-dark.png');
  await c.goto(URL + '#/templates/' + ids.will); await c.wait(800);
  const darkE = await c.eval(`(() => { const out = {}; const pick = (sel, name) => { const n = document.querySelector(sel); if (!n) { out[name] = 'missing'; return; } const cs = getComputedStyle(n); let el = n, b = cs.backgroundColor; while (el && (b === 'rgba(0, 0, 0, 0)' || b === 'transparent')) { el = el.parentElement; b = el ? getComputedStyle(el).backgroundColor : 'rgb(255,255,255)'; } out[name] = [cs.color, b]; }; pick('.editor-gutter', 'gutter'); pick('.editor-textarea', 'textarea'); pick('.editor-status', 'status'); pick('table.vars th', 'varsTh'); pick('table.vars td.path', 'varsPath'); pick('.tabs button', 'tab'); pick('.tabs button.active', 'tabActive'); pick('.var-extra label', 'extraLabel'); return out; })()`);
  for (const [k, v] of Object.entries(darkE)) console.log('dark-editor', k, v, v !== 'missing' ? contrast(v[0], v[1]) : '');
  await c.shot('17-editor-dark.png');
  await c.eval('window.onbeforeunload=null; true');
  await c.goto(URL + '#/settings'); await c.wait(400);
  await c.click('#theme-toggle'); await c.wait(200);
  console.log('theme back:', await c.eval('document.documentElement.getAttribute("data-theme")'));
  const light = await sample();
  for (const [k, v] of Object.entries(light)) console.log('light', k, v, v !== 'missing' ? contrast(v[0], v[1]) : '');
  // firm defaults
  await c.eval(`(() => { const i = document.querySelector('#set-firm'); i.value = 'Walters & Associates'; i.dispatchEvent(new Event('change')); const a = document.querySelector('#set-attorney'); a.value = 'Ariel Walters'; a.dispatchEvent(new Event('change')); return true; })()`); await c.wait(400);
  console.log('topbar firm:', await c.eval('document.getElementById("topbar-firm").textContent'));
  report('firm settings');
  // new blank template uses {[FirmName]} → interview prefilled
  await c.goto(URL + '#/templates'); await c.wait(400);
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent.includes('New template')).click(); true`); await c.wait(800);
  const tid = (await c.eval('location.hash')).split('/').pop();
  await c.eval('window.onbeforeunload=null; true');
  await c.goto(URL + '#/interview/' + tid); await c.wait(700);
  console.log('FirmName prefilled:', await c.eval(`(document.querySelector('.q[data-path="FirmName"] input') || {value:'NO FIELD'}).value`), 'progress:', await c.eval('document.querySelector(".progress span.small").textContent'));
  report('firm default in interview');
  // Export all / reset / import
  await c.goto(URL + '#/settings'); await c.wait(400);
  await c.eval(`window.__blobs = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); }; HTMLAnchorElement.prototype.click = function() {}; true`);
  await c.eval(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Export all data').click(); true`); await c.wait(300);
  const exported = await c.eval(`(async () => { const b = window.__blobs[0]; return b ? await b.text() : null; })()`);
  const ex = JSON.parse(exported);
  console.log('export counts:', Object.keys(ex.templates).length, Object.keys(ex.records).length, Object.keys(ex.packages).length, 'settings:', ex.settings.firmName);
  require('fs').writeFileSync(outFile('all-export.json'), exported);
  // Reset
  await c.eval(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Reset app').click(); true`); await c.wait(200);
  console.log('reset modal buttons:', await c.eval('[...document.querySelectorAll(".modal-foot button")].map(b => b.textContent)'));
  await c.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Export backup first').click(); true`); await c.wait(200);
  console.log('modal still open after export:', await c.eval('!!document.querySelector(".modal")'), 'blobs:', await c.eval('window.__blobs.length'));
  await c.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Delete everything').click(); true`); await c.wait(1500);
  report('reset');
  await c.goto(URL + '#/templates'); await c.wait(400);
  console.log('after reset templates:', await c.eval('document.querySelectorAll("table.list tbody tr").length'), 'first-run modal:', await c.eval('!!document.querySelector(".modal")'));
  await c.eval(`(() => { const m = document.querySelector('.modal'); if (m) [...m.querySelectorAll('button')].find(b => b.textContent === 'Start empty').click(); return true; })()`);
  await c.goto(URL + '#/settings'); await c.wait(400);
  await c.eval(`(() => { const o = HTMLInputElement.prototype.click; window.__fileInput = null; HTMLInputElement.prototype.click = function() { if (this.type === 'file') { window.__fileInput = this; } else o.call(this); }; return true; })()`);
  await c.eval(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Import (replace)').click(); true`); await c.wait(200);
  await c.send('DOM.getDocument', { depth: 0 });
  const objectId = (await c.send('Runtime.evaluate', { expression: 'window.__fileInput' })).result.objectId;
  const { nodeId } = await c.send('DOM.requestNode', { objectId });
  await c.send('DOM.setFileInputFiles', { files: [outFile('all-export.json')], nodeId });
  await c.wait(400);
  console.log('replace confirm:', await c.eval('!!document.querySelector(".modal")'));
  await c.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Replace').click(); true`); await c.wait(1500);
  report('import all');
  await c.goto(URL + '#/templates'); await c.wait(400);
  console.log('after import templates:', await c.eval('document.querySelectorAll("table.list tbody tr").length'), 'firm:', await c.eval('document.getElementById("topbar-firm").textContent'), 'records:', await c.eval('Object.keys(JSON.parse(localStorage.getItem("docassembly.v1")).records).length'));
  console.log('LOGS:', c.logs);
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
