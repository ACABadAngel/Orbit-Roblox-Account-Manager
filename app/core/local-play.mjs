// All HWNDs originate in the main process, never in renderer-supplied bounds.
export function playBounds(value) {
  if (!value || !['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight'].every(k => Number.isFinite(value[k]))) throw new Error('Invalid game area.');
  const { x, y, width, height, viewportWidth, viewportHeight } = value;
  if (x < 0 || y < 0 || width < 64 || height < 64 || viewportWidth > 20000 || viewportHeight > 20000 || x + width > viewportWidth + 1 || y + height > viewportHeight + 1) throw new Error('Game area must fit inside Orbit.');
  return { x, y, width, height, viewportWidth, viewportHeight };
}
export class LocalPlay {
  constructor(native) { this.native = native; this.current = null; this.tail = Promise.resolve(); }
  serial(run) { const result = this.tail.then(run); this.tail = result.catch(() => {}); return result; }
  open(id, window, host, bounds) {
    const area = playBounds(bounds);
    return this.serial(async () => {
      if (this.current) throw new Error('Close the current local play session first.');
      await this.native.call('dock', { window, host, bounds: area });
      this.current = id;
      return { mode: 'native' };
    });
  }
  resize(id, bounds) {
    const area = playBounds(bounds);
    return this.serial(async () => {
      if (this.current !== id) throw new Error('This local play session is no longer active.');
      await this.native.call('dock.resize', { bounds: area }); return true;
    });
  }
  close(id) {
    return this.serial(async () => {
      if (!this.current || (id && this.current !== id)) return;
      await this.native.call('undock'); this.current = null;
    });
  }
}
