const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();
  const report = c.report;
  await c.goto(URL + '#/records/rec_qa1'); await c.wait(600);
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent === 'Save').click(); true`); await c.wait(400);
  console.log('record keys after pruned save:', await c.eval('Object.keys(JSON.parse(localStorage.getItem("docassembly.v1")).records.rec_qa1.data)'));
  const eid = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); return Object.values(s.templates).find(t => t.name.includes('Engagement')).id; })()`);
  await c.goto(URL + '#/interview/' + eid + '?record=rec_qa1'); await c.wait(800);
  await c.eval(`(document.querySelector('.q[data-path="Client.IsEntity"] .segmented button:nth-child(2)') || document.querySelectorAll('.q[data-path="Client"] .q[data-path="IsEntity"] .segmented button')[1]).click(); true`); await c.wait(700);
  console.log('client sub after IsEntity=No:', await c.eval(`[...document.querySelectorAll('.q[data-path="Client"] .q')].map(n => n.dataset.path + '=' + ((n.querySelector('input,select,textarea')||{}).value))`));
  console.log('progress:', await c.eval('document.querySelector(".progress span.small").textContent'));
  await c.shot('10-engagement-prefilled.png');
  report('engagement prefill');
  await c.eval('window.onbeforeunload = null; true');
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
