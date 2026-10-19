import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
export class NativeHost {
  constructor() { this.nextId = 0; this.pending = new Map(); this.worker = null; }
  start() {
    if (process.platform !== 'win32') throw new Error('Roblox window control requires Windows 10 or 11.');
    if (this.worker) return;
    const script = fileURLToPath(new URL('../native/windows.ps1', import.meta.url)).replace('app.asar', 'app.asar.unpacked');
    this.worker = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.worker.stdout }).on('line', line => { try { const r = JSON.parse(line), pending = this.pending.get(r.id); if (!pending) return; clearTimeout(pending.timer); this.pending.delete(r.id); r.error ? pending.reject(new Error(r.error)) : pending.resolve(r.result); } catch { /* Ignore non-RPC startup output. */ } });
    const fail = () => { this.worker = null; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Windows helper stopped. Try again.')); } this.pending.clear(); };
    this.worker.on('error', fail); this.worker.on('exit', fail); this.worker.stderr.resume();
  }
  call(op, payload = {}) {
    this.start();
    return new Promise((resolve, reject) => {
      if (this.pending.size > 100) return reject(new Error('Input queue is busy.'));
      const id = ++this.nextId, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Windows helper timed out.')); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.stdin.write(JSON.stringify({ ...payload, id, op }) + '\n');
    });
  }
  async close() { if (!this.worker) return; const worker = this.worker; await this.call('shutdown').catch(() => {}); worker.stdin.end(); const timer = setTimeout(() => worker.kill(), 2000); timer.unref(); }
}
