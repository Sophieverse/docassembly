// Minimal CDP client over a hand-rolled WebSocket (Node 20, no deps).
const net = require('net'); const http = require('http'); const crypto = require('crypto'); const fs = require('fs');

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key } });
    req.on('upgrade', (res, sock) => {
      let buf = Buffer.alloc(0); let frag = [];
      const ws = { sock, onmessage: null, send(str) {
        const payload = Buffer.from(str); const mask = crypto.randomBytes(4);
        let hdr;
        if (payload.length < 126) hdr = Buffer.from([0x81, 0x80 | payload.length]);
        else if (payload.length < 65536) { hdr = Buffer.alloc(4); hdr[0] = 0x81; hdr[1] = 0xfe; hdr.writeUInt16BE(payload.length, 2); }
        else { hdr = Buffer.alloc(10); hdr[0] = 0x81; hdr[1] = 0xff; hdr.writeBigUInt64BE(BigInt(payload.length), 2); }
        const masked = Buffer.alloc(payload.length); for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
        sock.write(Buffer.concat([hdr, mask, masked]));
      }, close() { sock.end(); } };
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          const fin = buf[0] & 0x80, op = buf[0] & 0x0f; let len = buf[1] & 0x7f; let off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len); buf = buf.subarray(off + len);
          if (op === 8) { sock.end(); return; }
          if (op === 9) { continue; }
          if (op === 1 || op === 0) { frag.push(Buffer.from(payload)); if (fin) { const m = Buffer.concat(frag).toString(); frag = []; ws.onmessage && ws.onmessage(m); } }
        }
      });
      resolve(ws);
    });
    req.on('error', reject); req.end();
  });
}

async function connect(port) {
  const list = await new Promise((res, rej) => http.get(`http://127.0.0.1:${port}/json/list`, (r) => { let s = ''; r.on('data', (d) => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));
  const page = list.find((t) => t.type === 'page');
  const ws = await wsConnect(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const handlers = [];
  ws.onmessage = (m) => { const j = JSON.parse(m); if (j.id && pending.has(j.id)) { const { res, rej } = pending.get(j.id); pending.delete(j.id); j.error ? rej(new Error(j.error.message)) : res(j.result); } else if (j.method) handlers.forEach((h) => h(j)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const c = { send, on: (h) => handlers.push(h), close: () => ws.close(), logs: [], errors: [] };
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true }); await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Log.enable');
  c.dialogs = [];
  c.on((j) => {
    if (j.method === 'Page.javascriptDialogOpening') { c.dialogs.push(j.params.type + ': ' + j.params.message); send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }
    if (j.method === 'Runtime.consoleAPICalled') { const t = j.params.type; const txt = j.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '); c.logs.push(`[${t}] ${txt}`); if (t === 'error') c.errors.push('console.error: ' + txt); }
    if (j.method === 'Runtime.exceptionThrown') { const d = j.params.exceptionDetails; c.errors.push('EXCEPTION: ' + (d.exception && d.exception.description || d.text)); }
    if (j.method === 'Log.entryAdded' && j.params.entry.level === 'error' && !/beforeunload/.test(j.params.entry.text)) { c.errors.push('log: ' + j.params.entry.text + ' ' + (j.params.entry.url || '')); }
  });
  c.eval = async (expr, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  };
  c.goto = async (url) => { await send('Page.navigate', { url: 'about:blank' }); await c.wait(100); await send('Page.navigate', { url }); await c.wait(400); await c.eval('new Promise(r => document.readyState === "complete" ? r() : window.addEventListener("load", r))'); await c.wait(150); };
  c.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  c.shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); };
  c.click = async (sel) => c.eval(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) throw new Error('no element ' + ${JSON.stringify(sel)}); n.click(); return true; })()`);
  c.type = async (sel, text) => { await c.eval(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); n.focus(); return true; })()`); await send('Input.insertText', { text }); };
  c.key = async (key, opts = {}) => {
    const codes = { Tab: 9, Enter: 13, Escape: 27, Backspace: 8, ArrowDown: 40 };
    const base = { key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key], ...opts };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  c.drainErrors = () => { const e = c.errors.slice(); c.errors.length = 0; return e; };
  return c;
}
module.exports = { connect };
