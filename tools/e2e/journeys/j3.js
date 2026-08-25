const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();
  const report = c.report;
  const tid = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); return Object.values(s.templates).find(t => t.name.includes('Last Will')).id; })()`);
  await c.goto(URL + '#/interview/' + tid); await c.wait(500); report('open interview');
  const qs = async () => c.eval(`[...document.querySelectorAll('.interview-form > div > .q:not([data-leaving])')].map(n => n.dataset.path)`);
  console.log('initial questions:', await qs());
  console.log('progress:', await c.eval('document.querySelector(".progress span.small").textContent'));
  console.log('focused:', await c.eval('document.activeElement.tagName + " " + (document.activeElement.closest(".q") || {}).dataset?.path'));
  await c.shot('05-interview-start.png');
  const hasSpouse = async () => c.eval(`!!document.querySelector('.interview-form .q[data-path="Spouse"]:not([data-leaving])')`);
  console.log('spouse before:', await hasSpouse());
  // IsMarried Yes
  await c.eval(`document.querySelector('.q[data-path="IsMarried"] .segmented button').click(); true`); await c.wait(500);
  console.log('spouse after Yes:', await hasSpouse(), 'spouse fields:', await c.eval(`[...document.querySelectorAll('.q[data-path="Spouse"] .q')].map(n => n.dataset.path + ':' + n.dataset.type)`));
  await c.eval(`document.querySelectorAll('.q[data-path="IsMarried"] .segmented button')[1].click(); true`); await c.wait(500);
  console.log('spouse after No:', await hasSpouse());
  await c.eval(`document.querySelector('.q[data-path="IsMarried"] .segmented button').click(); true`); await c.wait(500);
  report('marry toggle');
  // fill testator
  const typeIn = async (sel, val) => c.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ${JSON.stringify(val)}; i.dispatchEvent(new Event('input', {bubbles:true})); i.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
  await typeIn('.q[data-path="Testator"] .q[data-path="FullName"] input', 'Eleanor Vance');
  await typeIn('.q[data-path="Testator"] .q[data-path="County"] textarea, .q[data-path="Testator"] .q[data-path="County"] input', 'Travis');
  await typeIn('.q[data-path="Testator"] .q[data-path="State"] input', 'Texas');
  console.log('gender control:', await c.eval(`(() => { const q = document.querySelector('.q[data-path="Testator"] .q[data-path="Gender"]'); return q ? q.querySelector('.radios, select') ? q.querySelector('.radios, select').outerHTML.slice(0, 300) : 'no control' : 'no gender q'; })()`));
  await c.eval(`(() => { const r = document.querySelector('.q[data-path="Testator"] .q[data-path="Gender"] input[type=radio]'); if (r) r.click(); return true; })()`);
  await typeIn('.q[data-path="Spouse"] .q[data-path="FullName"] input', 'Thomas Vance');
  await c.eval(`(() => { const r = document.querySelector('.q[data-path="Spouse"] .q[data-path="Gender"] input[type=radio]'); if (r) r.click(); return true; })()`);
  await c.wait(500); report('fill testator/spouse');
  // Children: add 2
  const guardian = async () => c.eval(`!!document.querySelector('.interview-form .q[data-path="Guardian"]:not([data-leaving])')`);
  console.log('guardian before children:', await guardian());
  await c.eval(`[...document.querySelectorAll('.q[data-path="Children"] button')].find(b => b.textContent.includes('Add')).click(); true`); await c.wait(400);
  console.log('child fields:', await c.eval(`[...document.querySelectorAll('.q[data-path="Children"] .list-item .q')].map(n => n.dataset.path + ':' + n.dataset.type)`));
  await typeIn('.q[data-path="Children"] .list-item:nth-of-type(1) .q[data-path="FullName"] input', 'Clara Vance');
  await typeIn('.q[data-path="Children"] .list-item:nth-of-type(1) .q[data-path="DOB"] input', '2004-05-19');
  await c.wait(500);
  console.log('guardian after adult child:', await guardian());
  await c.eval(`[...document.querySelectorAll('.q[data-path="Children"] button')].find(b => b.textContent.includes('Add')).click(); true`); await c.wait(400);
  await typeIn('.q[data-path="Children"] .list-item:nth-of-type(2) .q[data-path="FullName"] input', 'Owen Vance');
  await typeIn('.q[data-path="Children"] .list-item:nth-of-type(2) .q[data-path="DOB"] input', '2015-09-02');
  await c.wait(600);
  console.log('guardian after minor child:', await guardian(), 'children in data:', await c.eval(`document.querySelectorAll('.q[data-path="Children"] .list-item').length`));
  console.log('questions now:', await qs());
  await c.shot('06-interview-children.png');
  report('children');
  // remove minor child
  await c.eval(`[...document.querySelectorAll('.q[data-path="Children"] .list-item')][1].querySelector('button[title=Remove]').click(); true`); await c.wait(300);
  console.log('remove confirm shown:', await c.eval('!!document.querySelector(".modal")'));
  await c.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Remove').click(); true`); await c.wait(600);
  console.log('guardian after remove minor:', await guardian());
  // re-add minor
  await c.eval(`[...document.querySelectorAll('.q[data-path="Children"] button')].find(b => b.textContent.includes('Add')).click(); true`); await c.wait(400);
  await typeIn('.q[data-path="Children"] .list-item:nth-of-type(2) .q[data-path="FullName"] input', 'Owen Vance');
  await typeIn('.q[data-path="Children"] .list-item:nth-of-type(2) .q[data-path="DOB"] input', '2015-09-02');
  await c.wait(600);
  console.log('guardian re-added:', await guardian());
  console.log('progress:', await c.eval('document.querySelector(".progress span.small").textContent'));
  report('remove/re-add');
  // Generate with missing required → validation
  await c.eval(`document.querySelector('.sticky-actions button[type=submit]').click(); true`); await c.wait(600);
  console.log('hash after generate (should stay):', await c.eval('location.hash'));
  console.log('errSummary:', await c.eval('(document.querySelector(".interview-form .errors") || {textContent:"NONE"}).textContent.slice(0, 300)'));
  console.log('invalid count:', await c.eval('document.querySelectorAll(".q.invalid").length'));
  await c.shot('07-interview-validation.png');
  report('validation');
  // Now use sample answers to fill everything, then Generate
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent.includes('Use sample')).click(); true`); await c.wait(300);
  console.log('replace confirm shown:', await c.eval('!!document.querySelector(".modal")'));
  await c.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Replace').click(); true`); await c.wait(800);
  console.log('dialogs:', c.dialogs);
  console.log('progress after sample:', await c.eval('document.querySelector(".progress span.small").textContent'));
  console.log('gender radio checked:', await c.eval(`(() => { const q = document.querySelector('.q[data-path="Testator"] .q[data-path="Gender"]'); const r = q && q.querySelector('input:checked'); return r ? r.value : (q ? q.querySelector('select') ? q.querySelector('select').value : 'no radio checked' : 'noq'); })()`));
  await c.eval(`document.querySelector('.sticky-actions button[type=submit]').click(); true`); await c.wait(1200);
  console.log('hash after generate:', await c.eval('location.hash'));
  console.log('errSummary:', await c.eval('(document.querySelector(".interview-form .errors") || {textContent:"NONE"}).textContent.slice(0, 400)'));
  report('generate');
  console.log('LOGS:', c.logs);
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
