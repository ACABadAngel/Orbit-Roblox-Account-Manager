import { BrowserWindow, ipcMain, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rendererFile } from './core/renderer-file.mjs';
import { description, streamOptions } from './core/playback.mjs';

// Only this restricted, hidden renderer can capture the one validated HWND.
export class StreamHosts {
  constructor({ source, geometry, input, release }) {
    this.sessions = new Map(); this.source = source; this.geometry = geometry; this.input = input; this.release = release;
    this.file = fileURLToPath(new URL('./renderer/stream-host.html', import.meta.url));
    const trustedCapture = rendererFile(this.file);
    ipcMain.handle('orbit:stream-host', async (event, action, value) => {
      const record = [...this.sessions.values()].find(r => !r.window.isDestroyed() && r.window.webContents === event.sender);
      if (!record || event.senderFrame !== event.sender.mainFrame || !await trustedCapture(event.senderFrame.url)) throw new Error('Untrusted capture request.');
      if (action === 'config') return { sourceId: record.sourceId, options: record.options };
      if (action === 'offer') { record.resolve(description(value, 'offer')); return true; }
      if (action === 'error') { record.reject(new Error(String(value).slice(0, 200))); await this.stop(record.id, record.owner); return true; }
      if (action === 'input') {
        if (JSON.stringify(value).length > 4096) throw new Error('Input message too large.');
        record.until = Date.now() + 20000;
        return this.input(record.accountId, value.event, record.owner, value.leaseToken);
      }
      if (action === 'disconnected') { await this.stop(record.id, record.owner); return true; }
      throw new Error('Unsupported capture action.');
    });
    this.timer = setInterval(() => { for (const r of this.sessions.values()) if (r.until < Date.now()) this.stop(r.id, r.owner).catch(() => {}); }, 3000); this.timer.unref();
  }
  get(id, owner) { const r = this.sessions.get(id); if (!r || r.owner !== owner) throw new Error('This video session ended. Reopen Remote Play.'); return r; }
  async start(accountId, owner, raw) {
    const options = streamOptions(raw);
    for (const r of [...this.sessions.values()]) if (r.owner === owner) await this.stop(r.id, owner);
    if (this.sessions.size >= 3) throw new Error('This host already has three video streams. Close one first.');
    const { source, geometry } = await this.source(accountId);
    const id = randomUUID(), ses = session.fromPartition(`orbit-capture-${id}`);
    const window = new BrowserWindow({ show: false, width: 320, height: 180, webPreferences: { session: ses, preload: fileURLToPath(new URL('./stream-preload.cjs', import.meta.url)), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.setWebRTCIPHandlingPolicy('default');
    ses.setPermissionRequestHandler((wc, permission, done) => done(wc === window.webContents && permission === 'media'));
    ses.setPermissionCheckHandler((wc, permission) => wc === window.webContents && permission === 'media');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', e => e.preventDefault());
    let resolve, reject; const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timeout = setTimeout(() => reject(new Error('Video capture did not start within 20 seconds.')), 20000);
    const r = { id, owner, accountId, window, sourceId: source.id, geometry, options, until: Date.now() + 30000, resolve, reject };
    this.sessions.set(id, r);
    window.on('closed', () => { this.sessions.delete(id); reject(new Error('Video capture stopped.')); this.release(accountId, owner).catch(() => {}); });
    // Attach rejection handling before loadFile can fail.
    const loading = window.loadFile(this.file).catch(reject);
    try { const offer = await ready; await loading; return { id, offer, geometry, options }; }
    catch (e) { await this.stop(id, owner); throw e; }
    finally { clearTimeout(timeout); }
  }
  async answer(id, owner, answer) { const r = this.get(id, owner); r.until = Date.now() + 20000; r.window.webContents.send('orbit:stream-answer', description(answer, 'answer')); return true; }
  async ping(id, owner) { const r = this.get(id, owner); r.until = Date.now() + 20000; return { geometry: await this.geometry(r.accountId) }; }
  async stop(id, owner) { const r = this.sessions.get(id); if (!r || r.owner !== owner) return; this.sessions.delete(id); r.reject(new Error('Video session closed.')); if (!r.window.isDestroyed()) r.window.destroy(); await this.release(r.accountId, owner); }
  async stopAccount(id) { for (const r of [...this.sessions.values()]) if (r.accountId === id) await this.stop(r.id, r.owner); }
  async close() { for (const r of [...this.sessions.values()]) await this.stop(r.id, r.owner); }
}
