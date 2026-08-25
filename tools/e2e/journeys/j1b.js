const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();
  const report = c.report;
  await c.goto(URL + '#/templates');
  const ids = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const f = (n) => Object.values(s.templates).find(t => t.name.includes(n)).id; return { will: f('Last Will') }; })()`);
  console.log('stored model label:', await c.eval(`JSON.parse(localStorage.getItem('docassembly.v1')).templates['${ids.will}'].model.variables['Testator.FullName'].label`), 'var count:', await c.eval(`Object.keys(JSON.parse(localStorage.getItem('docassembly.v1')).templates['${ids.will}'].model.variables).length`));
  await c.goto(URL + '#/interview/' + ids.will); await c.wait(800); report('interview');
  console.log('labels:', await c.eval(`[...document.querySelectorAll('.interview-form label, .interview-form legend')].slice(0, 12).map(n => n.textContent)`));
  console.log('gender options:', await c.eval(`[...document.querySelectorAll('.q[data-path="Testator"] .q[data-path="Gender"] input')].map(i => i.value)`));
  await c.shot('21-interview-labels.png');
  await c.goto(URL + '#/templates/' + ids.will); await c.wait(800);
  await c.eval(`document.querySelector('.tabs button[data-tab=variables]').click(); true`); await c.wait(200);
  console.log('vars tab first labels:', await c.eval(`[...document.querySelectorAll('table.vars tbody tr:not(.hidden) input[type=text]')].slice(0, 5).map(i => i.value)`));
  await c.eval('window.onbeforeunload=null; true');
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
