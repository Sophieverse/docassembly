const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();
  const report = c.report;
  await c.goto(URL + '#/templates');
  if (!(await c.findId('Last Will'))) await c.seed(); // j8 leaves a recovered store behind; make sure the samples exist
  const ids = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const f = (n) => Object.values(s.templates).find(t => t.name.includes(n)).id; return { will: f('Last Will') }; })()`);
  await c.goto(URL + '#/interview/' + ids.will); await c.wait(800);
  const active = () => c.eval('(() => { const a = document.activeElement; const q = a.closest(".q"); return a.tagName + (a.type ? "[" + a.type + "]" : "") + (q ? " " + q.dataset.path : "") + (a.textContent && a.tagName === "BUTTON" ? " \'" + a.textContent.trim().slice(0, 12) + "\'" : ""); })()');
  const seq = [await active()];
  for (let i = 0; i < 12; i++) { await c.key('Tab'); seq.push(await active()); }
  console.log('tab order:', seq);
  // Enter in a text input must not generate
  await c.eval(`(() => { const i = document.querySelector('.q[data-path="Testator"] .q[data-path="FullName"] input'); i.focus(); return true; })()`);
  await c.send('Input.insertText', { text: 'Eleanor' });
  await c.key('Enter'); await c.wait(500);
  console.log('after Enter: hash=', await c.eval('location.hash'), 'focus=', await active(), 'errors shown=', await c.eval('!document.querySelector(".interview-form .errors").classList.contains("hidden")'));
  // Enter on Yes/No button toggles via keyboard
  await c.eval(`document.querySelector('.q[data-path="IsMarried"] .segmented button').focus(); true`);
  await c.key('Enter', { text: '\r' }); await c.wait(400);
  console.log('IsMarried via Enter on button:', await c.eval('document.querySelector(".q[data-path=IsMarried] .segmented button").classList.contains("on")'), 'spouse shown:', await c.eval('!!document.querySelector(".q[data-path=Spouse]")'));
  // Escape closes modal
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent.includes('Load from record')).click(); true`); await c.wait(300);
  console.log('modal open:', await c.eval('!!document.querySelector(".modal")'), 'focus in modal:', await c.eval('!!document.activeElement.closest(".modal")'));
  await c.key('Escape'); await c.wait(200);
  console.log('modal closed by Escape:', await c.eval('!document.querySelector(".modal")'), 'focus restored:', await active());
  // Tab trap inside modal
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent.includes('Save to record')).click(); true`); await c.wait(300);
  const inModal = [];
  for (let i = 0; i < 6; i++) { await c.key('Tab'); inModal.push(await c.eval('!!document.activeElement.closest(".modal")')); }
  console.log('focus stays in modal:', inModal.every(Boolean));
  await c.key('Escape'); await c.wait(200);
  console.log('dialogs:', c.dialogs);
  // Escape while prompt has text: no save
  console.log('records count unchanged:', await c.eval('Object.keys(JSON.parse(localStorage.getItem("docassembly.v1")).records).length'));
  report('keyboard');
  await c.eval('window.onbeforeunload = null; true');
  console.log('LOGS:', c.logs);
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
