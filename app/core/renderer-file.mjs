import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Renderer ownership and main-frame identity are checked by the caller. Compare
// the actual file too: Windows may spell the same path with 8.3 names or casing.
export function rendererFile(expected, { resolveFile = realpath, platform = process.platform } = {}) {
  let expectedPath; const verified = new Set();
  const canonical = path => platform === 'win32' ? path.toLowerCase() : path;
  return async value => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'file:' || url.search || url.hostname && url.hostname !== 'localhost') return false;
      url.hash = ''; const key = url.href;
      if (verified.has(key)) return true;
      expectedPath ||= resolveFile(expected).then(canonical);
      const [actual, target] = await Promise.all([resolveFile(fileURLToPath(url)).then(canonical), expectedPath]);
      if (actual !== target) return false;
      if (verified.size >= 16) verified.delete(verified.values().next().value);
      verified.add(key); return true;
    } catch { return false; }
  };
}
