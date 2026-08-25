const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();
  const report = c.report;
  await c.goto(URL + '#/packages'); await c.wait(400); report('packages list');
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent.includes('New package')).click(); true`); await c.wait(200);
  console.log('prompt focused input:', await c.eval('document.activeElement.tagName'));
  await c.send('Input.insertText', { text: 'Estate bundle' }); await c.key('Enter'); await c.wait(600);
  report('create package');
  console.log('hash:', await c.eval('location.hash'), 'h1:', await c.eval('document.querySelector("h1").textContent'));
  const ids = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const f = (n) => Object.values(s.templates).find(t => t.name.includes(n)).id; return { will: f('Last Will'), eng: f('Engagement') }; })()`);
  await c.eval(`(() => { const sel = document.querySelector('.card select'); sel.value = ${JSON.stringify(ids.will)}; sel.dispatchEvent(new Event('change')); return true; })()`); await c.wait(200);
  await c.eval(`(() => { const sel = document.querySelector('.card select'); sel.value = ${JSON.stringify(ids.eng)}; sel.dispatchEvent(new Event('change')); return true; })()`); await c.wait(200);
  console.log('items:', await c.eval('document.querySelectorAll(".pkg-item").length'));
  // includeIf with syntax error then valid
  await c.eval(`(() => { const i = document.querySelectorAll('.pkg-item input')[1]; i.value = 'IsMarried and ('; i.dispatchEvent(new Event('change')); return true; })()`); await c.wait(200);
  console.log('includeIf error shown:', await c.eval('document.querySelectorAll(".pkg-item .error")[1].textContent'));
  await c.eval(`(() => { const i = document.querySelectorAll('.pkg-item input')[1]; i.value = 'IsMarried'; i.dispatchEvent(new Event('change')); return true; })()`); await c.wait(300);
  console.log('includeIf error cleared:', JSON.stringify(await c.eval('document.querySelectorAll(".pkg-item .error")[1].textContent')));
  report('package config');
  await c.shot('11-package.png');
  const pid = (await c.eval('location.hash')).split('/').pop();
  // run package interview with record
  await c.goto(URL + `#/interview/pkg/${pid}?record=rec_qa1`); await c.wait(900); report('package interview');
  console.log('progress:', await c.eval('document.querySelector(".progress span.small").textContent'), 'badge:', await c.eval('!!document.querySelector(".page-head .badge")'));
  console.log('preview sections:', await c.eval('[...document.querySelectorAll(".interview-side > .flex")].map(n => n.textContent)'));
  const paths = await c.eval(`[...document.querySelectorAll('.interview-form > div > .q:not([data-leaving])')].map(n => n.dataset.path)`);
  console.log('has Testator+Client questions:', paths.includes('Testator'), paths.includes('Client'), 'count', paths.length);
  // Set IsMarried No → engagement not included
  await c.eval(`document.querySelectorAll('.q[data-path="IsMarried"] .segmented button')[1].click(); true`); await c.wait(700);
  console.log('preview after No:', await c.eval('[...document.querySelectorAll(".interview-side > .flex")].map(n => n.textContent)'));
  const paths2 = await c.eval(`[...document.querySelectorAll('.interview-form > div > .q:not([data-leaving])')].map(n => n.dataset.path)`);
  console.log('Client questions gone when excluded:', !paths2.includes('Client'));
  await c.eval(`document.querySelectorAll('.q[data-path="IsMarried"] .segmented button')[0].click(); true`); await c.wait(700);
  report('includeIf toggle');
  // Generate (record has all answers? engagement letter fields missing -> validation). Fill by JSON injection: use 'Save answers' then patch record and go to output directly
  await c.eval(`[...document.querySelectorAll('.sticky-actions button')].find(b => b.textContent === 'Save answers').click(); true`); await c.wait(500);
  report('save answers');
  await c.goto(URL + `#/output/pkg/${pid}?record=rec_qa1`); await c.wait(1200); report('package output');
  console.log('output docs:', await c.eval('document.querySelectorAll(".doc-host").length'), 'headers:', await c.eval('[...document.querySelectorAll(".output-layout h2")].map(n => n.textContent)'), 'not included badges:', await c.eval('document.querySelectorAll(".badge-warn").length'));
  console.log('side buttons:', await c.eval('[...document.querySelectorAll(".output-side button")].map(b => b.textContent + (b.disabled ? "(disabled)" : ""))'));
  await c.shot('12-package-output.png');
  await c.eval(`window.__blobs = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); }; HTMLAnchorElement.prototype.click = function() {}; true`);
  await c.eval(`[...document.querySelectorAll('.output-side button')].find(b => b.textContent.includes('Download')).click(); true`); await c.wait(2500);
  console.log('blobs downloaded:', await c.eval('window.__blobs.map(b => b.size)'));
  report('download all');
  console.log('dialogs:', c.dialogs, 'LOGS:', c.logs);
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
