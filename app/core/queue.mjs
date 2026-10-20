export class LaunchQueue {
  constructor({ launch, change = () => {}, settings = () => ({ launchDelayMs: 15000, maxConcurrent: 1 }), now = Date.now, delayFor = () => settings().launchDelayMs }) {
    this.launch = launch; this.delayFor = delayFor; this.change = change; this.settings = settings; this.now = now; this.pending = []; this.active = new Set(); this.paused = false; this.reason = ''; this.nextAt = 0; this.timer = null; this.generation = 0; this.cancelled = new Map();
  }
  enqueue(ids) { for (const id of ids) if (!this.active.has(id) && !this.pending.includes(id)) this.pending.push(id); this.change(); this.pump(); }
  prioritize(id) { if (!this.pending.includes(id)) return; this.pending = [id, ...this.pending.filter(x => x !== id)]; if (!this.paused) this.nextAt = this.now(); this.change(); this.pump(); }
  pause(reason = 'Paused by you') { this.paused = true; this.reason = reason; clearTimeout(this.timer); this.change(); }
  resume() { this.paused = false; this.reason = ''; this.change(); this.pump(); }
  cancel(ids) { const set = new Set(ids); this.pending = this.pending.filter(id => !set.has(id)); for (const id of ids) if (this.cancelled.has(id)) this.cancelled.get(id).value = true; this.change(); }
  stop() { this.generation++; this.pending = []; this.pause('Stopped'); }
  get snapshot() { return { pending: [...this.pending], active: [...this.active], paused: this.paused, reason: this.reason, nextAt: this.nextAt }; }
  pump() {
    clearTimeout(this.timer);
    if (this.paused || !this.pending.length || this.active.size >= this.settings().maxConcurrent) return;
    const wait = this.nextAt - this.now();
    if (wait > 0) { this.timer = setTimeout(() => this.pump(), wait); this.timer.unref?.(); return; }
    const id = this.pending.shift(), generation = this.generation, cancellation = { value: false }; this.cancelled.set(id, cancellation);
    this.active.add(id); this.nextAt = this.now() + this.delayFor(id); this.change();
    Promise.resolve().then(() => this.launch(id, () => generation !== this.generation || cancellation.value)).catch(error => {
      if (error.pauseQueue) { this.nextAt = Math.max(this.nextAt, this.now() + (error.retryAfterMs || 60000)); this.pause(error.message); }
    }).finally(() => { this.active.delete(id); this.change(); this.pump(); });
    this.pump();
  }
}
