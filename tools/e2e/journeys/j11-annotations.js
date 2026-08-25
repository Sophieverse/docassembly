// Template @annotations in the editor: "from template" badges, edit → reset, Rules editor, annotation warnings, Insert helper, help page.
const { connect, URL, done } = require('../lib.js');
(async () => {
  const c = await connect();
  await c.goto(URL + '#/templates'); await c.wait(300);
  if (!(await c.eval('(() => { try { return Object.keys(JSON.parse(localStorage.getItem("docassembly.v1")).templates).length > 0; } catch (e) { return false; } })()'))) await c.seed();
  const tut = await c.findId('Tutorial');
  const will = await c.findId('Last Will');
  // Interview labels that come from @label annotations
  await c.goto(URL + '#/interview/' + tut); await c.wait(700);
  const labels = await c.eval(`[...document.querySelectorAll('.q label')].map(l => l.textContent.replace('*', '').trim()).slice(0, 12)`);
  console.log('tutorial labels:', labels);
  if (!labels.some((l) => /Client's full legal name/.test(l))) console.log('ERR @label annotation not shown in interview');
  const willFrom = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const v = s.templates['${will}'].model.variables; return Object.entries(v).filter(([p, d]) => d.fromTemplate && Object.keys(d.fromTemplate).length).map(([p, d]) => p + ':' + Object.keys(d.fromTemplate).join('/')); })()`);
  console.log('Will variables with fromTemplate:', willFrom.length, willFrom.slice(0, 6));
  if (willFrom.length) {
    await c.goto(URL + '#/interview/' + will); await c.wait(700);
    const path = willFrom[0].split(':')[0];
    console.log('Will interview label for', path, '=', await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); return s.templates['${will}'].model.variables[${JSON.stringify(path)}].label; })()`), 'shown:', await c.eval(`!![...document.querySelectorAll('.q label')].find(l => l.textContent.includes(${JSON.stringify((await c.eval(`JSON.parse(localStorage.getItem('docassembly.v1')).templates['${will}'].model.variables[${JSON.stringify(path)}].label`)))}))`));
  }
  c.report('interview labels');
  await c.eval('window.onbeforeunload = null; true');
  // Editor Variables tab: badges
  await c.goto(URL + '#/templates/' + tut); await c.wait(900);
  await c.eval(`document.querySelector('.tabs button[data-tab=variables]').click(); true`); await c.wait(300);
  const badges = await c.eval(`[...document.querySelectorAll('table.vars .badge-tpl')].map(b => { const tr = b.closest('tr'); const p = tr.querySelector('td.path') || tr.previousElementSibling.querySelector('td.path'); return p.textContent.replace('rules','') + ':' + b.dataset.field + '=' + b.textContent; })`);
  console.log('badges:', badges.length, badges.slice(0, 8));
  if (!badges.some((b) => b.startsWith('Client.FullName:label=from template'))) console.log('ERR no "from template" badge on Client.FullName label');
  console.log('badge title:', await c.eval(`document.querySelector('table.vars .badge-tpl[data-field=label]').title`));
  // Edit the label → badge "edited" + reset button; reset → template label back
  await c.eval(`(() => { const i = document.querySelector('table.vars input[aria-label="Label for Client.FullName"]'); i.value = 'My own label'; i.dispatchEvent(new Event('change')); return true; })()`); await c.wait(1500);
  const afterEdit = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const v = s.templates['${tut}'].model.variables['Client.FullName']; return { label: v.label, custom: v.custom }; })()`);
  console.log('after edit stored:', JSON.stringify(afterEdit));
  if (!afterEdit.custom || afterEdit.custom.label !== true) console.log('ERR custom.label flag not set on edit');
  // A re-merge (typing in the template) must keep the user's label
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.value += '\\n'; ta.dispatchEvent(new Event('input')); return true; })()`); await c.wait(1800);
  console.log('label kept after recompile:', await c.eval(`JSON.parse(localStorage.getItem('docassembly.v1')).templates['${tut}'].model.variables['Client.FullName'].label`));
  await c.eval(`document.querySelector('.tabs button[data-tab=variables]').click(); true`); await c.wait(300);
  const editedBadge = await c.eval(`(() => { const row = [...document.querySelectorAll('table.vars tr')].find(r => r.querySelector('td.path') && r.querySelector('td.path').textContent.startsWith('Client.FullName')); const b = row.querySelector('.badge-tpl[data-field=label]'); const r = row.querySelector('button.reset-field'); return { badge: b && b.textContent, reset: !!r, value: row.querySelector('input[type=text]').value }; })()`);
  console.log('edited row:', JSON.stringify(editedBadge));
  await c.shot('25-editor-badges.png');
  await c.eval(`(() => { const row = [...document.querySelectorAll('table.vars tr')].find(r => r.querySelector('td.path') && r.querySelector('td.path').textContent.startsWith('Client.FullName')); row.querySelector('button.reset-field').click(); return true; })()`); await c.wait(1500);
  const afterReset = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const v = s.templates['${tut}'].model.variables['Client.FullName']; const row = [...document.querySelectorAll('table.vars tr')].find(r => r.querySelector('td.path') && r.querySelector('td.path').textContent.startsWith('Client.FullName')); return { label: v.label, custom: v.custom, shown: row.querySelector('input[type=text]').value, badge: row.querySelector('.badge-tpl[data-field=label]').textContent }; })()`);
  console.log('after reset:', JSON.stringify(afterReset));
  if (afterReset.label !== "Client's full legal name") console.log('ERR reset to template did not restore the annotation label');
  // Rules editor: open ⋯ on Fee, set max, verify stored + custom flag
  await c.eval(`(() => { const row = [...document.querySelectorAll('table.vars tr')].find(r => r.querySelector('td.path') && r.querySelector('td.path').textContent.startsWith('Fee')); row.querySelector('button[title^="Options"]').click(); const extra = row.nextElementSibling; extra.querySelector('details.rules').open = true; return { rulesOpen: extra.querySelector('details.rules').open, minShown: extra.querySelector('input[type=text].mono').value, minBadge: (extra.querySelector('.badge-tpl[data-field=min]') || {}).textContent }; })()`).then((r) => console.log('Fee rules row:', JSON.stringify(r)));
  await c.eval(`(() => { const row = [...document.querySelectorAll('table.vars tr')].find(r => r.querySelector('td.path') && r.querySelector('td.path').textContent.startsWith('Fee')); const extra = row.nextElementSibling; const inputs = [...extra.querySelectorAll('.var-rules input')]; const max = inputs[1]; max.value = '99999'; max.dispatchEvent(new Event('change')); return true; })()`); await c.wait(1500);
  console.log('Fee after max edit:', await c.eval(`(() => { const v = JSON.parse(localStorage.getItem('docassembly.v1')).templates['${tut}'].model.variables['Fee']; return { min: v.min, max: v.max, custom: v.custom, fromTemplate: v.fromTemplate }; })()`));
  c.report('variables tab');
  // Annotation error: unknown key + bad regex → warnings with line jump
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.value = '{[# @bogus Fee: 1]}\\n{[# @pattern Fee: ( ]}\\n' + ta.value; ta.dispatchEvent(new Event('input')); return true; })()`); await c.wait(900);
  const warn = await c.eval(`(() => { const w = document.querySelector('.annotation-warnings'); return { hidden: w.classList.contains('hidden'), text: w.textContent, status: document.querySelector('.editor-status').textContent }; })()`);
  console.log('annotation warnings:', JSON.stringify(warn));
  if (warn.hidden || !/Unknown annotation @bogus/.test(warn.text) || !/invalid regular expression/.test(warn.text)) console.log('ERR annotation errors not shown');
  console.log('syntax errors box hidden (annotations never block):', await c.eval('document.querySelector(".editor-left .errors").classList.contains("hidden")'));
  await c.eval(`document.querySelectorAll('.annotation-warnings div')[1].click(); true`); await c.wait(200);
  console.log('line jump: selection line =', await c.eval('(() => { const ta = document.querySelector(".editor-textarea"); return ta.value.slice(0, ta.selectionStart).split("\\n").length; })()'));
  await c.shot('26-annotation-warnings.png');
  // Insert annotation helper
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.setSelectionRange(0, 0); return true; })()`);
  await c.eval(`[...document.querySelectorAll('.editor-toolbar button')].find(b => b.textContent.includes('Annotation')).click(); true`); await c.wait(300);
  await c.eval(`(() => { const m = document.querySelector('.modal'); const sel = m.querySelector('select'); sel.value = 'help'; sel.dispatchEvent(new Event('change')); const inputs = m.querySelectorAll('input[type=text]'); inputs[0].value = 'Fee'; inputs[1].value = 'Total fee before tax'; [...m.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Insert').click(); return true; })()`); await c.wait(1800);
  console.log('inserted:', JSON.stringify(await c.eval('document.querySelector(".editor-textarea").value.split("\\n")[0]')), 'help applied:', await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); return s.templates['${tut}'].model.variables.Fee.help; })()`));
  // Cleanup: remove injected lines so later journeys see the original sample
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.value = ta.value.split('\\n').filter(l => !/@bogus|@pattern Fee: \\(|@help Fee: Total fee/.test(l)).join('\\n'); ta.dispatchEvent(new Event('input')); return true; })()`); await c.wait(1800);
  c.report('annotation warnings + insert helper');
  await c.eval('window.onbeforeunload = null; true');
  // Help page has the Annotations reference
  await c.goto(URL + '#/help'); await c.wait(300);
  console.log('help annotations section:', await c.eval(`(() => { const h = [...document.querySelectorAll('h2')].find(h => /Annotations/.test(h.textContent)); const t = h.nextElementSibling.nextElementSibling; return h ? { rows: t.querySelectorAll('tr').length, pattern: [...t.querySelectorAll('code')].find(c => c.textContent.includes('@pattern')).textContent } : null; })()`));
  c.report('help');
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
