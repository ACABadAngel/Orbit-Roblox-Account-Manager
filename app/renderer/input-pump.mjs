// Preserve key/button transitions while combining motion that has not been sent.
export class InputPump {
  constructor(send, error = () => {}) { this.send = send; this.error = error; this.queue = []; this.running = false; this.closed = false; }
  push(value) {
    if (this.closed) return;
    const last = this.queue.at(-1), type = value.event?.type;
    if (last?.leaseToken === value.leaseToken && last?.event?.type === type && ['mousemove', 'relative', 'heartbeat'].includes(type)) {
      if (type === 'relative') { last.event.dx += value.event.dx; last.event.dy += value.event.dy; last.event.dx = Math.max(-2000, Math.min(2000, last.event.dx)); last.event.dy = Math.max(-2000, Math.min(2000, last.event.dy)); }
      else this.queue[this.queue.length - 1] = value;
    } else this.queue.push(value);
    if (this.queue.length > 256) { this.close(); this.error(new Error('Input queue overflow. Release control and reconnect.')); return; }
    this.drain();
  }
  async drain() {
    if (this.running || this.closed) return; this.running = true;
    try { while (this.queue.length && !this.closed) await this.send(this.queue.shift()); }
    catch (error) { this.queue.length = 0; this.error(error); }
    finally { this.running = false; }
  }
  close() { this.closed = true; this.queue.length = 0; }
}
