import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Only an Orbit-created, disposable profile is inspected. Existing browser
// profiles and the user's other tabs are never attached or read.
export async function browserLogin({ connected, changed = () => {} }) {
  if (process.platform !== 'win32') throw new Error('Browser sign-in requires Windows.');
  const candidates = [
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
  ];
  let executable; for (const file of candidates) { if (await stat(file).then(s => s.isFile()).catch(() => false)) { executable = file; break; } }
  if (!executable) throw new Error('Install Microsoft Edge or Google Chrome, or use the built-in sign-in window.');
  const directory = await mkdtemp(join(tmpdir(), 'orbit-signin-'));
  let outcome = null, lastError = '', lastCookie = '', child, socket, stopped = false, processing = false, nextId = 0, timer; const requests = new Map();
  const close = async () => {
    if (stopped) return; stopped = true; clearTimeout(timer); socket?.close();
    for (const { reject, timer } of requests.values()) { clearTimeout(timer); reject(new Error('Sign-in closed.')); } requests.clear();
    child?.kill();
    for (let i = 0; i < 10; i++) { try { await rm(directory, { recursive: true, force: true }); break; } catch { await delay(300); } }
    changed();
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN || stopped) return reject(new Error('Sign-in browser is closed.'));
    const id = ++nextId, timer = setTimeout(() => { requests.delete(id); reject(new Error('Sign-in browser timed out.')); }, 5000);
    requests.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    child = spawn(executable, [`--user-data-dir=${directory}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--new-window', 'https://www.roblox.com/login'], { stdio: 'ignore' });
    let spawnError; child.once('error', () => { spawnError = true; }); child.once('exit', () => { close().catch(() => {}); });
    let endpoint;
    for (let i = 0; i < 100; i++) {
      if (spawnError || stopped) throw new Error('Could not open the sign-in browser.');
      try { const [port, path] = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); if (/^\d+$/.test(port) && /^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(path)) { endpoint = `ws://127.0.0.1:${port}${path}`; break; } } catch {}
      await delay(100);
    }
    if (!endpoint) throw new Error('Could not connect to the disposable sign-in browser. Use built-in sign-in instead.');
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Sign-in browser connection timed out.')), 5000); socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true }); socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Sign-in browser connection failed.')); }, { once: true }); });
    socket.addEventListener('message', event => { try { const r = JSON.parse(event.data), p = requests.get(r.id); if (!p) return; requests.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(new Error('Sign-in browser could not read its session.')) : p.resolve(r.result); } catch {} });
    socket.addEventListener('close', () => { close().catch(() => {}); });
    const poll = async () => {
      if (stopped) return;
      try {
        const result = await send('Storage.getCookies');
        const cookie = result.cookies?.find(c => c.name === '.ROBLOSECURITY' && ['.roblox.com','www.roblox.com','roblox.com'].includes(c.domain));
        if (cookie && cookie.value !== lastCookie && !processing) { processing = true; lastCookie = cookie.value; try { outcome = await connected(cookie.value); await close(); return; } catch { lastError = 'Roblox could not validate this session. Complete sign-in or verification, or cancel and try again.'; processing = false; } }
      } catch {}
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return { close, get outcome() { return outcome; }, get error() { return lastError; }, get closed() { return stopped; } };
  } catch (e) { await close(); throw e; }
}
