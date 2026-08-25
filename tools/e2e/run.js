#!/usr/bin/env node
// Runs every journey in tools/e2e/journeys against a headless Chrome and a static server for the repo.
// Usage: node tools/e2e/run.js [journey-name-filter ...]   (e.g. `node tools/e2e/run.js j10 j11`)
// Exit code is non-zero when any journey reports a console error / exception / FATAL.
const path = require('path'); const fs = require('fs'); const net = require('net'); const http = require('http'); const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const JOURNEYS = process.env.E2E_JOURNEYS || path.join(__dirname, 'journeys');
const OUT = process.env.E2E_OUT || path.join(__dirname, 'out');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
function serve(port) {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      let file = path.normalize(path.join(ROOT, u === '/' ? '/index.html' : u));
      if (!file.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
      fs.stat(file, (err, st) => {
        if (!err && st.isDirectory()) file = path.join(file, 'index.html');
        fs.readFile(file, (e2, data) => {
          if (e2) { rsp.writeHead(404); rsp.end('not found'); return; }
          rsp.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
          rsp.end(data);
        });
      });
    });
    srv.listen(port, '127.0.0.1', () => res(srv));
  });
}
function findChrome() {
  if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  const mac = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')];
  const linux = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  const win = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, 'Google/Chrome/Application/chrome.exe'));
  for (const p of [...mac, ...win]) if (fs.existsSync(p)) return p;
  for (const name of linux) { const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' }); if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split('\n')[0]; }
  return null;
}
function waitFor(url, ms = 10000) {
  const t0 = Date.now();
  return new Promise((res, rej) => {
    const tick = () => { http.get(url, (r) => { r.resume(); res(); }).on('error', () => { if (Date.now() - t0 > ms) rej(new Error('Chrome did not open its debugging port')); else setTimeout(tick, 150); }); };
    tick();
  });
}
const natural = (a, b) => { const na = /^j(\d+)([a-z]*)/.exec(a) || [], nb = /^j(\d+)([a-z]*)/.exec(b) || []; return (Number(na[1] || 0) - Number(nb[1] || 0)) || String(na[2] || '').localeCompare(String(nb[2] || '')) || a.localeCompare(b); };

(async () => {
  const filters = process.argv.slice(2);
  let files = fs.readdirSync(JOURNEYS).filter((f) => f.endsWith('.js')).sort(natural);
  if (filters.length) files = files.filter((f) => filters.some((x) => f.includes(x)));
  if (!files.length) { console.error('No journeys matched.'); process.exit(2); }
  const chrome = findChrome();
  if (!chrome) { console.error('Chrome not found. Set CHROME=/path/to/chrome.'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const httpPort = await freePort(); const cdpPort = await freePort();
  const server = await serve(httpPort);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'docassembly-e2e-'));
  const chromeLog = fs.openSync(path.join(OUT, 'chrome.log'), 'w');
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1400,900', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', chromeLog, chromeLog] });
  const cleanup = () => { try { proc.kill(); } catch (e) { /* */ } try { server.close(); } catch (e) { /* */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* */ } };
  process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });
  try { await waitFor(`http://127.0.0.1:${cdpPort}/json/version`); } catch (e) { console.error(e.message); cleanup(); process.exit(2); }
  console.log(`server http://127.0.0.1:${httpPort}/  chrome cdp :${cdpPort}  (${path.basename(chrome)})  out: ${path.relative(ROOT, OUT)}`);
  const env = { ...process.env, E2E_URL: `http://127.0.0.1:${httpPort}/index.html`, E2E_CDP_PORT: String(cdpPort), E2E_OUT: OUT };
  const results = [];
  for (const f of files) {
    const t0 = Date.now();
    console.log(`\n=== ${f}`);
    // Async spawn: the static server lives in this process, so the journey must not block the event loop.
    const r = await new Promise((res) => {
      let out = '';
      const child = spawn(process.execPath, [path.join(JOURNEYS, f)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { out += '\nFATAL journey timed out after 180s\n'; child.kill('SIGKILL'); }, 180000);
      child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
      child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
      child.on('error', (error) => { clearTimeout(timer); res({ status: 1, out, error }); });
      child.on('close', (status) => { clearTimeout(timer); res({ status, out }); });
    });
    const out = r.out;
    if (!out.endsWith('\n')) process.stdout.write('\n');
    const errLines = out.split('\n').filter((l) => /^ERR |FATAL|^EXCEPTION/.test(l));
    const failed = r.status !== 0 || errLines.length > 0 || !!r.error || !/\bok  |ERR /.test(out); // a silent journey is a hung one
    results.push({ f, failed, ms: Date.now() - t0, detail: r.error ? String(r.error.message) : errLines.slice(0, 3).join(' | ') });
    fs.writeFileSync(path.join(OUT, f.replace(/\.js$/, '.txt')), out);
  }
  console.log('\n=== summary');
  for (const r of results) console.log(`${r.failed ? 'FAIL' : 'pass'}  ${r.f}  ${(r.ms / 1000).toFixed(1)}s${r.detail ? '  ' + r.detail : ''}`);
  const nFail = results.filter((r) => r.failed).length;
  console.log(`${results.length - nFail}/${results.length} journeys passed`);
  cleanup();
  process.exit(nFail ? 1 : 0);
})().catch((e) => { console.error('runner failed:', e); process.exit(2); });
