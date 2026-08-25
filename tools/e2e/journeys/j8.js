const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();
  const report = c.report;
  const ids = await (async () => { await c.goto(URL + '#/templates'); return c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const f = (n) => Object.values(s.templates).find(t => t.name.includes(n)).id; return { will: f('Last Will') }; })()`); })();
  // --- unknown route
  await c.goto(URL + '#/nonsense/route'); await c.wait(400);
  console.log('404 main text:', JSON.stringify(await c.eval('document.querySelector("#main").textContent.trim().slice(0, 80)')), 'hash:', await c.eval('location.hash'));
  await c.shot('18-404.png');
  report('404');
  // --- deep link fresh load
  await c.goto(URL + '#/interview/' + ids.will + '?record=rec_qa1'); await c.wait(800);
  console.log('deep link h1:', await c.eval('document.querySelector("h1").textContent'), 'questions:', await c.eval('document.querySelectorAll(".interview-form .q").length'));
  await c.goto(URL + '#/interview/does-not-exist'); await c.wait(400);
  console.log('missing template:', JSON.stringify(await c.eval('document.querySelector("#main").textContent.trim().slice(0, 60)')));
  report('deep links');
  // --- back/forward
  await c.goto(URL + '#/templates'); await c.wait(300);
  await c.eval('location.hash = "#/records"; true'); await c.wait(300);
  await c.eval('location.hash = "#/packages"; true'); await c.wait(300);
  await c.eval('history.back(); true'); await c.wait(700);
  console.log('after back:', await c.eval('location.hash'), await c.eval('document.querySelector("h1").textContent'), 'active nav:', await c.eval('document.querySelector(".topnav a.active")?.textContent'));
  await c.eval('history.back(); true');
  let h1 = null; for (let i = 0; i < 20 && !h1; i++) { await c.wait(150); h1 = await c.eval('document.querySelector("h1") ? document.querySelector("h1").textContent : null'); }
  console.log('after back2:', await c.eval('location.href'), h1, h1 ? '' : 'DOC=' + JSON.stringify(await c.eval('document.documentElement.outerHTML.slice(0, 200)')));
  if (!h1) { await c.eval('history.forward(); true'); await c.wait(700); console.log('  fwd again:', await c.eval('location.href')); }
  await c.eval('history.forward(); true'); await c.wait(700);
  console.log('after fwd:', await c.eval('location.hash'), await c.eval('document.querySelector("h1").textContent'));
  report('back/forward');
  // --- editor: leave with unsaved text via hash nav → persisted?
  await c.goto(URL + '#/templates/' + ids.will); await c.wait(700);
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.value = ta.value + '\\n\\nQA-LEAVE-MARKER {[QaMarker]}'; ta.dispatchEvent(new Event('input')); return true; })()`);
  await c.wait(50);
  await c.eval('location.hash = "#/templates"; true'); await c.wait(500);
  console.log('text persisted on leave:', await c.eval(`JSON.parse(localStorage.getItem('docassembly.v1')).templates['${ids.will}'].text.includes('QA-LEAVE-MARKER')`), 'model has QaMarker:', await c.eval(`!!JSON.parse(localStorage.getItem('docassembly.v1')).templates['${ids.will}'].model.variables.QaMarker`), 'onbeforeunload cleared:', await c.eval('window.onbeforeunload === null'));
  // label edit survives recompile
  await c.goto(URL + '#/templates/' + ids.will); await c.wait(700);
  await c.eval(`document.querySelector('.tabs button[data-tab=variables]').click(); true`); await c.wait(200);
  await c.eval(`(() => { const tr = [...document.querySelectorAll('table.vars tbody tr')].find(t => t.querySelector('td.path') && t.querySelector('td.path').textContent === 'QaMarker'); const i = tr.querySelector('input[type=text]'); i.value = 'QA label'; i.dispatchEvent(new Event('change')); return true; })()`);
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.value = ta.value + ' more text'; ta.dispatchEvent(new Event('input')); return true; })()`);
  await c.wait(1800);
  console.log('label survives recompile+autosave:', await c.eval(`JSON.parse(localStorage.getItem('docassembly.v1')).templates['${ids.will}'].model.variables.QaMarker.label`));
  report('editor persistence');
  // --- long template typing latency
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); let s = ''; for (let i = 0; i < 500; i++) s += (i % 10 === 0 ? '# Section ' + i + '\\n' : 'Paragraph ' + i + ' {[Var' + (i % 40) + ']} {[if Flag' + (i % 7) + ']}yes{[else]}no{[end if]} lorem ipsum dolor sit amet.\\n'); ta.value = s; ta.dispatchEvent(new Event('input')); return true; })()`);
  await c.wait(1500);
  console.log('status:', await c.eval('document.querySelector(".editor-status").textContent'));
  await c.eval(`window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); true`);
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return true; })()`);
  const times = [];
  for (let i = 0; i < 25; i++) {
    const t0 = Date.now();
    await c.send('Input.insertText', { text: 'x' });
    await c.eval('1'); // round trip forces event loop
    times.push(Date.now() - t0);
    await c.wait(40);
  }
  await c.wait(1000);
  const handler = await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); const t = []; for (let i = 0; i < 10; i++) { const t0 = performance.now(); ta.setRangeText('y', ta.value.length, ta.value.length, 'end'); ta.dispatchEvent(new Event('input')); t.push(+(performance.now() - t0).toFixed(1)); } return t; })()`);
  await c.wait(1200);
  console.log('keystroke roundtrip ms:', times.join(','), 'max', Math.max(...times));
  console.log('sync input-handler ms:', handler.join(','));
  console.log('long tasks ms during typing:', await c.eval('window.__long'));
  // preview tab on long template
  await c.eval(`document.querySelector('.tabs button[data-tab=preview]').click(); true`); await c.wait(800);
  const t0 = Date.now(); await c.eval(`(() => { const q = document.querySelector('.preview-answers .q[data-path="Flag0"] .segmented button'); if (q) q.click(); return true; })()`); await c.wait(600);
  console.log('preview long tasks:', await c.eval('window.__long.slice(-5)'));
  report('long template');
  await c.eval('window.onbeforeunload = null; true');
  // --- localStorage quota
  await c.goto(URL + '#/templates/' + ids.will); await c.wait(700);
  const filled = await c.eval(`(() => { let n = 0; for (const size of [512, 64, 8, 1]) { const chunk = 'x'.repeat(1024 * size); for (;;) { try { localStorage.setItem('qa.fill' + n, chunk); n++; } catch (e) { break; } } } return { n, free: 'lt 1KB' }; })()`);
  console.log('filled storage:', JSON.stringify(filled));
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); ta.value = ta.value + '\\n' + 'z'.repeat(1500000); ta.dispatchEvent(new Event('input')); return true; })()`);
  await c.wait(1800);
  console.log('toasts:', await c.eval('[...document.querySelectorAll(".toast")].map(t => t.textContent)'));
  await c.eval(`(() => { const ta = document.querySelector('.editor-textarea'); for (let i = 0; i < 5; i++) { ta.value += 'q'; ta.dispatchEvent(new Event('input')); } return true; })()`);
  await c.wait(1800);
  console.log('toasts after more typing (should not stack):', await c.eval('document.querySelectorAll(".toast").length'));
  await c.shot('19-quota.png');
  report('quota');
  await c.eval(`(() => { Object.keys(localStorage).filter(k => k.startsWith('qa.fill')).forEach(k => localStorage.removeItem(k)); return true; })()`);
  console.log('store intact after quota:', await c.eval(`(() => { try { const s = JSON.parse(localStorage.getItem('docassembly.v1')); return Object.keys(s.templates).length; } catch (e) { return 'CORRUPT ' + e.message; } })()`), 'prev snapshot exists:', await c.eval('!!localStorage.getItem("docassembly.v1.prev")'));
  await c.eval('window.onbeforeunload = null; true');
  // --- corrupt storage recovery
  await c.eval(`localStorage.setItem('docassembly.v1', '{"templates": {"a": ' ); true`);
  await c.goto(URL + '#/templates'); await c.wait(600);
  console.log('recovery banner:', JSON.stringify(await c.eval('(document.querySelector(".banner")||{textContent:"NONE"}).textContent.slice(0, 160)')), 'templates restored from snapshot:', await c.eval('document.querySelectorAll("table.list tbody tr").length'), 'corrupt stash keys:', await c.eval('Object.keys(localStorage).filter(k => k.includes("corrupt"))'));
  await c.shot('20-recovery.png');
  report('corrupt recovery');
  // restore will text (remove long junk) for later tests
  await c.goto(URL + '#/templates'); await c.wait(400);
  console.log('second load after corruption: banner again?', await c.eval('!!document.querySelector(".banner")'), 'stash count:', await c.eval('Object.keys(localStorage).filter(k => k.includes("corrupt")).length'), 'main key parses:', await c.eval('(() => { try { JSON.parse(localStorage.getItem("docassembly.v1")); return true; } catch (e) { return false; } })()'));
  await c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const t = s.templates['${ids.will}']; if (!t) return false; const i = t.text.indexOf('QA-LEAVE-MARKER'); if (i > 0) t.text = t.text.slice(0, i).trimEnd(); localStorage.setItem('docassembly.v1', JSON.stringify(s)); Object.keys(localStorage).filter(k => k.includes('corrupt')).forEach(k => localStorage.removeItem(k)); return true; })()`);
  console.log('LOGS:', c.logs.slice(0, 10));
  done(c);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
