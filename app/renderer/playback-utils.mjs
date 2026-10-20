export function streamOptions(raw = {}) {
  const fps = raw.fps ?? 60, height = raw.height ?? 720, bitrate = raw.bitrate ?? 8;
  if (![30, 60].includes(fps) || ![480, 720, 1080].includes(height) || !Number.isFinite(bitrate) || bitrate < 1 || bitrate > 40) throw new Error('Invalid stream quality.');
  return { fps, height, bitrate, adaptive: raw.adaptive !== false };
}
export function description(value, type) {
  if (!value || value.type !== type || typeof value.sdp !== 'string' || value.sdp.length > 60000 || !value.sdp.startsWith('v=0')) throw new Error('Invalid stream negotiation.');
  return { type, sdp: value.sdp };
}
export function inputEvent(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid input.');
  const { type } = raw;
  if (type === 'heartbeat') return { type };
  if (type === 'keydown' || type === 'keyup') {
    if (!Number.isInteger(raw.key) || raw.key < 8 || raw.key > 222 || [91, 92, 93].includes(raw.key)) throw new Error('Unsupported key.');
    return { type, key: raw.key };
  }
  if (type === 'relative') {
    if (![raw.dx, raw.dy].every(n => Number.isFinite(n) && Math.abs(n) <= 2000)) throw new Error('Invalid relative movement.');
    return { type, dx: Math.round(raw.dx), dy: Math.round(raw.dy) };
  }
  if (!['mousemove', 'mousedown', 'mouseup', 'wheel'].includes(type) || ![raw.x, raw.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || ![undefined, 0, 1, 2].includes(raw.button)) throw new Error('Invalid pointer event.');
  if (type === 'wheel' && (!Number.isFinite(raw.delta) || Math.abs(raw.delta) > 10000)) throw new Error('Invalid wheel.');
  return { type, x: raw.x, y: raw.y, relative: raw.relative === true, ...(raw.button !== undefined ? { button: raw.button } : {}), ...(type === 'wheel' ? { delta: raw.delta } : {}) };
}
// Coordinates refer to the displayed pixels, never the surrounding letterbox.
export function videoPoint(rect, width, height, clientX, clientY, geometry) {
  if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0)) return null;
  const scale = Math.min(rect.width / width, rect.height / height), w = width * scale, h = height * scale;
  let x = (clientX - rect.left - (rect.width - w) / 2) / w, y = (clientY - rect.top - (rect.height - h) / 2) / h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  if (geometry) {
    // Chromium may capture the client area, DWM visible frame, or full HWND.
    // Pick the reported geometry whose aspect ratio matches the actual track.
    const candidates = [geometry.client, geometry.visible, geometry.outer].filter(Boolean);
    const box = candidates.sort((a, b) => Math.abs(a.width / a.height - width / height) - Math.abs(b.width / b.height - width / height))[0];
    const c = geometry.client;
    if (box && c) { x = (box.x + x * box.width - c.x) / c.width; y = (box.y + y * box.height - c.y) / c.height; }
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  }
  return { x, y };
}
