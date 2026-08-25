// Shared helpers for journeys: connection, base URL, per-journey output dir, step reporter.
// Env (set by run.js): E2E_URL (http://127.0.0.1:<port>/index.html), E2E_CDP_PORT, E2E_OUT.
const path = require('path'); const fs = require('fs');
const { connect: cdpConnect } = require('./cdp.js');

const URL = process.env.E2E_URL || 'http://127.0.0.1:8765/index.html';
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9333);
const OUT = process.env.E2E_OUT || path.join(__dirname, 'out');
const FIXTURES = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
async function connect() {
  const c = await cdpConnect(CDP_PORT);
  const shot = c.shot;
  c.shot = (file) => shot(path.isAbsolute(file) ? file : path.join(OUT, file));
  // Step reporter: prints "ok  step" / "ERR step" and remembers failures for the exit code.
  c.report = (step, filter = (x) => !x.includes('favicon')) => {
    const e = c.drainErrors().filter(filter);
    if (e.length) failures++;
    console.log((e.length ? 'ERR ' : 'ok  ') + step + (e.length ? '\n    ' + e.join('\n    ') : ''));
  };
  // Load sample templates from a clean store (first-run modal).
  c.seed = async () => {
    await c.goto(URL + '#/templates');
    await c.eval('localStorage.clear(); sessionStorage.clear(); true');
    await c.goto(URL + '#/templates');
    await c.eval(`[...document.querySelectorAll('.modal button')].find(b => b.textContent.includes('Load sample')).click(); true`);
    await c.wait(600);
  };
  c.templateIds = async () => c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const out = {}; for (const t of Object.values(s.templates)) out[t.name] = t.id; return out; })()`);
  c.findId = async (namePart) => c.eval(`(() => { const s = JSON.parse(localStorage.getItem('docassembly.v1')); const t = Object.values(s.templates).find(t => t.name.includes(${JSON.stringify(namePart)})); return t ? t.id : null; })()`);
  return c;
}
/** Finish a journey: flush remaining errors, set exit code, close. */
function done(c, label = 'end') {
  c.report(label);
  if (failures) process.exitCode = 1;
  try { c.close(); } catch (e) { /* ignore */ }
}
const fixture = (name) => path.join(FIXTURES, name);
const outFile = (name) => path.join(OUT, name);
module.exports = { connect, URL, OUT, FIXTURES, fixture, outFile, done, failures: () => failures };
