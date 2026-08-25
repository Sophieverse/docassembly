const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();
  const report = c.report;
  await c.goto(URL + '#/templates');
  await c.eval('localStorage.clear(); sessionStorage.clear(); true');
  await c.goto(URL + '#/templates');
  console.log('first-run modal present:', await c.eval('!!document.querySelector(".modal")'));
  await c.shot('01-first-run.png');
  // Click "Load sample templates"
  await c.eval(`[...document.querySelectorAll('.modal button')].find(b => b.textContent.includes('Load sample')).click(); true`);
  await c.wait(500);
  report('load samples');
  console.log('rows:', await c.eval('document.querySelectorAll("table.list tbody tr").length'), 'modal gone:', await c.eval('!document.querySelector(".modal")'));
  console.log('names:', await c.eval('[...document.querySelectorAll("table.list td .name")].map(n=>n.textContent)'));
  // open Last Will
  const href = await c.eval(`[...document.querySelectorAll("a.rowlink")].find(a => a.textContent.includes('Last Will')).getAttribute('href')`);
  await c.eval(`location.hash = ${JSON.stringify(href)}; true`); await c.wait(800);
  report('open editor');
  await c.shot('02-editor-vars.png');
  const vars = await c.eval(`[...document.querySelectorAll('table.vars tbody tr:not(.hidden)')].map(tr => [tr.querySelector('td.path').textContent, tr.querySelector('input[type=text]').value || tr.querySelector('input[type=text]').placeholder, tr.querySelector('select').value])`);
  console.log(JSON.stringify(vars, null, 0));
  console.log('status:', await c.eval('document.querySelector(".editor-status").textContent'));
  // Gender options
  await c.eval(`(() => { const tr = [...document.querySelectorAll('table.vars tbody tr')].find(t => t.querySelector('td.path') && t.querySelector('td.path').textContent === 'Testator.Gender'); tr.querySelector('button').click(); })()`);
  console.log('gender extra:', await c.eval(`(() => { const tr = [...document.querySelectorAll('table.vars tbody tr')].find(t => t.querySelector('td.path') && t.querySelector('td.path').textContent === 'Testator.Gender'); const ex = tr.nextElementSibling; return ex.textContent.slice(0,200) + ' | ta=' + (ex.querySelector('textarea') ? ex.querySelector('textarea').value : 'NONE'); })()`));
  // Change label + type of Testator.County
  await c.eval(`(() => { const tr = [...document.querySelectorAll('table.vars tbody tr')].find(t => t.querySelector('td.path') && t.querySelector('td.path').textContent === 'Testator.County'); const i = tr.querySelector('input[type=text]'); i.value = 'County of residence'; i.dispatchEvent(new Event('change')); const s = tr.querySelector('select'); s.value = 'longtext'; s.dispatchEvent(new Event('change')); return true; })()`);
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent === 'Save').click(); true`);
  await c.wait(400);
  report('edit var + save');
  // Reload page
  await c.eval('window.onbeforeunload = null; true');
  await c.goto(URL + href);
  await c.wait(600);
  report('reload editor');
  console.log('persisted:', await c.eval(`(() => { const tr = [...document.querySelectorAll('table.vars tbody tr')].find(t => t.querySelector('td.path') && t.querySelector('td.path').textContent === 'Testator.County'); return [tr.querySelector('input[type=text]').value, tr.querySelector('select').value]; })()`));
  console.log('stored model:', await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const t = Object.values(s.templates).find(t => t.name.includes('Last Will')); return JSON.stringify(t.model.variables['Testator.County']); })()`));
  console.log('LOGS:', c.logs.slice(0, 20));
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
