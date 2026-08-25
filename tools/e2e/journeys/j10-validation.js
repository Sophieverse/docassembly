// Engine validation rules in the UI: list-level @validate blocks Generate, item min/max, date min/max attributes,
// list item-count gating, record-editor advisory warnings. Stands alone (reseeds the store).
const { connect, URL, done } = require('../lib.js');
(async () => {
  const c = await connect();
  await c.seed(); c.report('seed');
  const llc = await c.findId('LLC');
  await c.goto(URL + '#/interview/' + llc); await c.wait(700); c.report('open LLC interview');
  // Sample answers: Members 60/30/10 → valid
  await c.eval(`[...document.querySelectorAll('.page-head button')].find(b => b.textContent.includes('Use sample answers')).click(); true`); await c.wait(900);
  const pct = async () => c.eval(`[...document.querySelectorAll('.q[data-full^="Members["][data-full$=".Percent"] input')].map(i => i.value)`);
  console.log('member percents:', await pct(), 'list error:', await c.eval('(document.querySelector(".q[data-full=Members] .list-field > .error") || {}).textContent || null'));
  // Remove third member (30 + 10 → set 60 + 50)
  await c.eval(`[...document.querySelectorAll('.list-item[data-full="Members[2]"] .list-item-head button')].find(b => b.textContent === 'Remove').click(); true`); await c.wait(300);
  await c.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'Remove').click(); true`); await c.wait(500);
  const setPercent = async (i, v) => { await c.eval(`(() => { const n = document.querySelector('.q[data-full="Members[${i}].Percent"] input'); n.focus(); n.select(); return true; })()`); await c.send('Input.insertText', { text: String(v) }); await c.wait(700); };
  await setPercent(1, 50);
  const listErr = await c.eval('(document.querySelector(".q[data-full=Members] .list-field > .error") || {}).textContent || null');
  console.log('60 + 50 → list-level error:', JSON.stringify(listErr), 'members invalid:', await c.eval('document.querySelector(".q[data-full=Members]").classList.contains("invalid")'));
  if (!/total 100/.test(listErr || '')) console.log('ERR expected list-level rule error for 60+50');
  // Item-level: 150 exceeds @max 100
  await setPercent(0, 150);
  const itemErr = await c.eval('(document.querySelector(".q[data-full=\\"Members[0].Percent\\"] > .error") || {}).textContent || null');
  console.log('150 → item error:', JSON.stringify(itemErr), 'max attr:', await c.eval('document.querySelector(".q[data-full=\\"Members[0].Percent\\"] input").getAttribute("max")'), 'min attr:', await c.eval('document.querySelector(".q[data-full=\\"Members[0].Percent\\"] input").getAttribute("min")'));
  if (!/at most 100/.test(itemErr || '')) console.log('ERR expected item-level max error');
  await setPercent(0, 60);
  // Generate must be blocked (60 + 50)
  await c.eval(`document.querySelector('.interview-form button[type=submit]').click(); true`); await c.wait(600);
  const summary = await c.eval('(() => { const s = document.querySelector(".interview-form .errors"); return s.classList.contains("hidden") ? null : s.textContent; })()');
  console.log('generate blocked:', await c.eval('location.hash.startsWith("#/interview/")'), 'summary:', JSON.stringify((summary || '').slice(0, 160)));
  if (!summary || !/total 100/.test(summary)) console.log('ERR generate not blocked by list-level rule');
  // Summary link focuses the field
  await c.eval(`(() => { const a = [...document.querySelectorAll('.interview-form .errors a')].find(a => /total 100/.test(a.textContent)); a.click(); return true; })()`); await c.wait(300);
  console.log('summary link focus:', await c.eval('(() => { const a = document.activeElement; const q = a.closest(".q"); return q ? q.dataset.full : a.tagName; })()'));
  await c.shot('22-llc-validation.png');
  // Fix: 50 / 50 → error clears live, Generate proceeds
  await setPercent(0, 50);
  console.log('50 + 50 → list error gone:', await c.eval('!document.querySelector(".q[data-full=Members] .list-field > .error")'), 'summary hidden:', await c.eval('document.querySelector(".interview-form .errors").classList.contains("hidden")'));
  await c.eval(`document.querySelector('.interview-form button[type=submit]').click(); true`); await c.wait(600);
  console.log('record-name prompt shown:', await c.eval('!!document.querySelector(".modal input")'));
  await c.eval(`(() => { const b = [...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'OK'); if (b) b.click(); return true; })()`); await c.wait(1200);
  const hash = await c.eval('location.hash');
  console.log('after generate hash:', hash, 'remaining summary:', await c.eval('(() => { const s = document.querySelector(".interview-form .errors"); return s && !s.classList.contains("hidden") ? s.textContent.slice(0, 300) : null; })()'));
  if (!hash.startsWith('#/output/')) console.log('ERR generate did not proceed with 50/50');
  c.report('LLC member validation');
  await c.eval('window.onbeforeunload = null; true');

  // --- Date min/max, pattern, list item-count gating, text-item list: a template built for the purpose
  const text = [
    '{[# @min SigningDate: 2020-01-01', '@max SigningDate: 2030-12-31', '@label SigningDate: Date signed', '@pattern Zip: ^\\d{5}$', '@maxLength Zip: 5',
    '@minLength Witnesses: 2', '@maxLength Witnesses: 3', '@default State: Texas', '@type Fee: currency', '@min Fee: 0 ]}',
    'Signed {[SigningDate|format:"long"]} in {[State]} ({[Zip]}), fee {[Fee|currency]}.',
    'Witnesses: {[Witnesses|join:"and"]}.', '{[if State = "Texas"]}Texas law applies.{[end if]}',
  ].join('\n');
  const tid = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const id = 'tpl_e2e_rules'; const now = new Date().toISOString(); s.templates[id] = { id, name: 'E2E rules', description: '', text: ${JSON.stringify(text)}, model: { variables: {}, order: [] }, createdAt: now, updatedAt: now }; localStorage.setItem('docassembly.v1', JSON.stringify(s)); return id; })()`);
  await c.goto(URL + '#/templates/' + tid); await c.wait(800);
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.value += '\\n'; ta.dispatchEvent(new Event('input')); return true; })()`); await c.wait(1800); // autosave the merged model
  console.log('annotation warnings (should be none):', await c.eval('document.querySelector(".annotation-warnings").classList.contains("hidden") ? "none" : document.querySelector(".annotation-warnings").textContent'));
  console.log('model rules:', await c.eval(`(() => { const v = JSON.parse(localStorage.getItem('docassembly.v1')).templates['${tid}'].model.variables; return { SigningDate: [v.SigningDate.min, v.SigningDate.max, v.SigningDate.fromTemplate && Object.keys(v.SigningDate.fromTemplate)], Zip: [v.Zip.pattern, v.Zip.maxLength], Witnesses: [v.Witnesses.type, v.Witnesses.itemType, v.Witnesses.minLength, v.Witnesses.maxLength], State: v.State.default, Fee: [v.Fee.type, v.Fee.min] }; })()`));
  c.report('rules editor autosave');
  await c.eval('window.onbeforeunload = null; true');
  await c.goto(URL + '#/interview/' + tid); await c.wait(800);
  const attrs = await c.eval(`(() => { const d = document.querySelector('.q[data-full=SigningDate] input'); const z = document.querySelector('.q[data-full=Zip] input'); const st = document.querySelector('.q[data-full=State] input'); return { dateMin: d.getAttribute('min'), dateMax: d.getAttribute('max'), dateLabel: document.querySelector('.q[data-full=SigningDate] label').textContent, zipPattern: z.getAttribute('pattern'), zipMax: z.getAttribute('maxlength'), stateDefault: st.value, stateDatalist: !!st.list, hint: (document.querySelector('.q[data-full=Witnesses] .list-field .flex .muted') || {}).textContent }; })()`);
  console.log('attributes:', JSON.stringify(attrs));
  if (attrs.dateMin !== '2020-01-01' || attrs.dateMax !== '2030-12-31') console.log('ERR date min/max attributes missing');
  if (attrs.zipPattern !== '^\\d{5}$') console.log('ERR pattern attribute missing');
  // Out-of-range date → inline error (live)
  await c.eval(`(() => { const d = document.querySelector('.q[data-full=SigningDate] input'); d.value = '2035-01-01'; d.dispatchEvent(new Event('input')); return true; })()`); await c.wait(700);
  console.log('date 2035 error:', await c.eval('(document.querySelector(".q[data-full=SigningDate] > .error") || {}).textContent || null'));
  await c.eval(`(() => { const d = document.querySelector('.q[data-full=SigningDate] input'); d.value = '2026-08-24'; d.dispatchEvent(new Event('input')); return true; })()`); await c.wait(700);
  console.log('date fixed error gone:', await c.eval('!document.querySelector(".q[data-full=SigningDate] > .error")'));
  // Zip pattern
  await c.eval(`(() => { const z = document.querySelector('.q[data-full=Zip] input'); z.focus(); return true; })()`); await c.send('Input.insertText', { text: 'abc' }); await c.wait(700);
  console.log('zip abc error:', await c.eval('(document.querySelector(".q[data-full=Zip] > .error") || {}).textContent || null'));
  // Witnesses: simple text list, min 2 / max 3
  const addW = async (name) => { await c.eval(`[...document.querySelectorAll('.q[data-full=Witnesses] button')].find(b => b.textContent.startsWith('+ Add')).click(); true`); await c.wait(150); if (name) { await c.eval(`(() => { const rows = document.querySelectorAll('.q[data-full=Witnesses] .list-item-simple input'); rows[rows.length - 1].focus(); return true; })()`); await c.send('Input.insertText', { text: name }); } await c.wait(200); };
  await addW('Ann');
  console.log('1 witness: remove disabled (min 2):', await c.eval('document.querySelector(".q[data-full=Witnesses] .list-item-simple button[title*=Remove], .q[data-full=Witnesses] .list-item-simple button:last-child").disabled'));
  await addW('Bob'); await addW('Cy');
  console.log('3 witnesses: add disabled (max 3):', await c.eval('[...document.querySelectorAll(".q[data-full=Witnesses] button")].find(b => b.textContent.startsWith("+ Add")).disabled'), 'value:', await c.eval(`(() => { return [...document.querySelectorAll('.q[data-full=Witnesses] .list-item-simple input')].map(i => i.value); })()`));
  await c.shot('23-rules-interview.png');
  // Save answers → record; Witnesses is a string[]
  await c.eval(`[...document.querySelectorAll('.sticky-actions button')].find(b => b.textContent === 'Save answers').click(); true`); await c.wait(300);
  await c.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === 'OK').click(); true`); await c.wait(500);
  const rec = await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const r = Object.values(s.records).find(r => r.name.startsWith('E2E rules')); return r ? { id: r.id, Witnesses: r.data.Witnesses, State: r.data.State, Zip: r.data.Zip } : null; })()`);
  console.log('saved record:', JSON.stringify(rec));
  if (!rec || !Array.isArray(rec.Witnesses) || rec.Witnesses[0] !== 'Ann') console.log('ERR text list not saved as string[]');
  c.report('rules interview');
  await c.eval('window.onbeforeunload = null; true');
  // Record editor shows the advisory warning (Zip "abc" fails the pattern)
  await c.goto(URL + '#/records/' + rec.id); await c.wait(800);
  console.log('record warning:', await c.eval('(() => { const w = document.querySelector(".panel .warn-list"); return w && !w.classList.contains("hidden") ? w.textContent : null; })()'), 'zip field invalid:', await c.eval('!!document.querySelector(".q[data-full=Zip].invalid")'), 'save enabled:', await c.eval('!document.querySelector(".page-head .btn-primary").disabled'));
  await c.shot('24-record-warnings.png');
  c.report('record editor');
  await c.eval('window.onbeforeunload = null; true');
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
