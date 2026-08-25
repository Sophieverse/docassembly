const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();
  const report = c.report;
  await c.goto(URL + '#/templates');
  // create blank template
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent.includes('New template')).click(); true`);
  await c.wait(700); report('new template');
  const hash = await c.eval('location.hash');
  console.log('hash', hash, 'status', await c.eval('document.querySelector(".editor-status").textContent'));
  // Type a broken template
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.value = 'Hello {[Name]}\\n{[if X]}\\nno end'; ta.dispatchEvent(new Event('input')); return true; })()`);
  await c.wait(600); report('broken template');
  console.log('errBox:', await c.eval('document.querySelector(".errors").className + " :: " + document.querySelector(".errors").textContent'));
  console.log('gutter err lines:', await c.eval('[...document.querySelectorAll(".editor-gutter .ln-err")].map(n=>n.textContent)'));
  await c.shot('03-editor-error.png');
  // fix
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.value = 'Hello {[Name]}\\n{[if X]}\\nyes\\n{[end if]}'; ta.dispatchEvent(new Event('input')); return true; })()`);
  await c.wait(600); report('fixed template');
  console.log('errBox hidden:', await c.eval('document.querySelector(".errors").classList.contains("hidden")'), await c.eval('document.querySelector(".editor-status").textContent'));
  // toolbar inserts at cursor: put cursor at position 6 (after 'Hello ')
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.focus(); ta.setSelectionRange(6, 6); return true; })()`);
  await c.eval(`[...document.querySelectorAll('.editor-toolbar button')].find(b => b.textContent === 'Insert field').click(); true`);
  await c.wait(200);
  console.log('insert modal:', await c.eval('!!document.querySelector(".modal")'), 'focused input:', await c.eval('document.activeElement.tagName + "." + document.activeElement.placeholder'));
  await c.eval(`(() => { const i = document.querySelector('.modal input'); i.value = 'Client.FullName'; i.dispatchEvent(new Event('input')); return true; })()`);
  await c.key('Enter'); await c.wait(300);
  report('insert field via Enter');
  let v = await c.eval('document.querySelector(".editor-textarea").value'); console.log('after insert field:', JSON.stringify(v.slice(0, 40)), 'sel:', await c.eval('document.querySelector(".editor-textarea").selectionStart'));
  // Insert If
  await c.eval(`[...document.querySelectorAll('.editor-toolbar button')].find(b => b.textContent.startsWith('If')).click(); true`); await c.wait(100);
  v = await c.eval('document.querySelector(".editor-textarea").value'); console.log('after insert if:', JSON.stringify(v.slice(0, 90)));
  // Insert List at end
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.setSelectionRange(ta.value.length, ta.value.length); return true; })()`);
  await c.eval(`[...document.querySelectorAll('.editor-toolbar button')].find(b => b.textContent === 'List').click(); true`); await c.wait(500);
  v = await c.eval('document.querySelector(".editor-textarea").value'); console.log('after insert list tail:', JSON.stringify(v.slice(-45)), 'selected:', await c.eval('(() => { const t = document.querySelector(".editor-textarea"); return t.value.slice(t.selectionStart, t.selectionEnd); })()'));
  report('toolbar inserts');
  // Filter insertion inside field
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); const i = ta.value.indexOf('Client.FullName') + 'Client.FullName'.length; ta.setSelectionRange(i, i); return true; })()`);
  await c.eval(`[...document.querySelectorAll('.editor-toolbar button')].find(b => b.textContent.startsWith('Filter')).click(); true`); await c.wait(150);
  await c.eval(`[...document.querySelectorAll('.modal .picker-list button')][0].click(); true`); await c.wait(400);
  v = await c.eval('document.querySelector(".editor-textarea").value'); console.log('after filter:', JSON.stringify(v.slice(0, 40)));
  report('filter insert');
  // Logic map tab
  await c.eval(`document.querySelector('.tabs button[data-tab=logic]').click(); true`); await c.wait(200);
  console.log('logic:', await c.eval('document.querySelector(".tab-body").textContent.slice(0, 300)'));
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.setSelectionRange(0,0); ta.blur(); return true; })()`);
  await c.eval(`document.querySelector('.logic-item a').click(); true`); await c.wait(100);
  console.log('after jump: active=', await c.eval('document.activeElement.className'), 'selStart=', await c.eval('document.querySelector(".editor-textarea").selectionStart'), 'hl=', await c.eval('[...document.querySelectorAll(".editor-gutter .ln-hl")].map(n=>n.textContent)'));
  report('logic map jump');
  // Preview tab
  await c.eval(`document.querySelector('.tabs button[data-tab=preview]').click(); true`); await c.wait(400);
  console.log('preview answers:', await c.eval('[...document.querySelectorAll(".preview-answers .q")].map(n => n.dataset.path + ":" + n.dataset.type)'));
  console.log('doc before:', JSON.stringify(await c.eval('document.querySelector(".preview-doc").textContent.slice(0, 200)')));
  // Click Yes on X boolean
  await c.eval(`(() => { const q = document.querySelector('.preview-answers .q[data-path="X"]'); q.querySelector('.segmented button').click(); return true; })()`);
  await c.wait(400);
  const docYes = await c.eval('document.querySelector(".preview-doc").textContent');
  console.log('doc after Yes contains "yes":', docYes.includes('yes'), 'contains "text when true":', docYes.includes('text when true'));
  await c.eval(`(() => { const q = document.querySelector('.preview-answers .q[data-path="X"]'); q.querySelectorAll('.segmented button')[1].click(); return true; })()`);
  await c.wait(400);
  const docNo = await c.eval('document.querySelector(".preview-doc").textContent');
  console.log('doc after No contains "yes":', docNo.includes('yes'), 'contains "text when false":', docNo.includes('text when false'));
  await c.shot('04-editor-preview.png');
  report('preview toggles');
  console.log('final text:', JSON.stringify(await c.eval('document.querySelector(".editor-textarea").value')));
  console.log('LOGS:', c.logs);
  await c.eval('window.onbeforeunload = null; true');
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
