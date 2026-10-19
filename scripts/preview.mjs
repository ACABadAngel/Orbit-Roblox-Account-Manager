import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const base = resolve('app/renderer'), types = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
export const server = http.createServer(async (req, res) => {
  try { const path = resolve(base, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); if (path !== base && !path.startsWith(base + sep)) throw new Error(); const data = await readFile(path === base ? resolve(base, 'index.html') : path); res.writeHead(200, { 'Content-Type': types[extname(path)] || (path === base ? 'text/html' : 'application/octet-stream'), 'Cache-Control': 'no-store' }); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
});
if (process.argv[1]?.endsWith('preview.mjs')) server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Orbit design preview: http://127.0.0.1:${server.address().port}/#demo`));
