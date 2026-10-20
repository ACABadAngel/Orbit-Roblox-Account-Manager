import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Ledger, problem } from './ledger.mjs';
import { Billing } from './billing.mjs';
import { serviceOrigin } from '../app/core/license-client.mjs';
const digest = value => createHash('sha256').update(value || '').digest();
const bearer = req => /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || '';
async function body(req, raw = false) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > (raw ? 1000000 : 50000)) throw problem('Request is too large.', 413); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  if (raw) return bytes;
  try { const value = JSON.parse(bytes.toString() || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { throw problem('Invalid JSON.'); }
}
export function licenseServer({ ledger, adminToken, publicUrl, stripeSecret, stripeWebhookSecret, prices, trialDays = 0, stripe }) {
  if (typeof adminToken !== 'string' || adminToken.length < 32) throw new Error('Set a random admin token of at least 32 characters.');
  const origin = serviceOrigin(publicUrl), billing = new Billing({ ledger, origin, secret: stripeSecret, webhookSecret: stripeWebhookSecret, prices, stripe });
  const rates = new Map(); let catalog = null, catalogAt = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const path = new URL(req.url, origin).pathname, method = req.method;
      const address = req.socket.remoteAddress || 'unknown', now = Date.now();
      if (rates.size >= 10000) for (const [key, value] of rates) if (now - value.at > 60000) rates.delete(key);
      if (rates.size >= 10000 && !rates.has(address)) throw problem('Service is busy. Try again shortly.', 429);
      const rate = rates.get(address) || { at: now, count: 0 }; if (now - rate.at > 60000) { rate.at = now; rate.count = 0; } rate.count++; rates.set(address, rate);
      if (rates.size > 10000) for (const [key, value] of rates) if (now - value.at > 60000) rates.delete(key);
      if (rate.count > 240) { res.setHeader('Retry-After', '60'); throw problem('Too many requests. Try again shortly.', 429); }
      if (path === '/health' && method === 'GET') return json({ ok: true });
      if (path === '/v1/info' && method === 'GET') return json({ issuer: 'orbit-license-v1', publicKey: ledger.publicKey });
      if (path === '/v1/catalog' && method === 'GET') { if (!catalog || now - catalogAt > 300000) { catalog = await billing.catalog(); catalogAt = now; } return json({ offers: catalog, trialDays }); }
      if (path === '/v1/webhook' && method === 'POST') return json(await billing.webhook(await body(req, true), req.headers['stripe-signature']));
      if (path.startsWith('/admin/api/')) {
        if (!timingSafeEqual(digest(bearer(req)), digest(adminToken))) throw problem('Admin sign-in required.', 401);
        if (req.headers.origin && req.headers.origin !== origin) throw problem('Unexpected request origin.', 403);
        if (path === '/admin/api/licenses' && method === 'GET') return json(ledger.list());
        if (path === '/admin/api/licenses' && method === 'POST') {
          const value = await body(req), count = value.count ?? 1;
          if (!Number.isInteger(count) || count < 1 || count > 100) throw problem('Choose a batch size from 1 to 100.');
          return json({ keys: ledger.transaction(() => Array.from({ length: count }, () => ledger.create(value))) }, 201);
        }
        const match = /^\/admin\/api\/licenses\/([a-f0-9-]{36})(\/devices)?$/.exec(path);
        if (match) {
          if (match[2] && method === 'GET') return json({ devices: ledger.db.prepare('SELECT deviceId,name,active,lastSeenAt FROM devices WHERE licenseId=?').all(match[1]) });
          if (match[2] && method === 'POST') { const value = await body(req); ledger.db.prepare('UPDATE devices SET active=0 WHERE licenseId=? AND deviceId=?').run(match[1], String(value.deviceId)); ledger.audit('admin-deactivate', match[1]); return json({ ok: true }); }
          if (!match[2] && method === 'POST') return json(ledger.update(match[1], await body(req)));
        }
        throw problem('Unknown admin endpoint.', 404);
      }
      if (path === '/v1/activate' && method === 'POST') { const v = await body(req); return json(ledger.activate(bearer(req), v.deviceId, v.deviceName)); }
      if (path === '/v1/refresh' && method === 'POST') { const v = await body(req); const row = ledger.findKey(bearer(req)); const device = ledger.db.prepare('SELECT name FROM devices WHERE licenseId=? AND deviceId=?').get(row.id, v.deviceId); return json(ledger.activate(bearer(req), v.deviceId, device?.name, true)); }
      if (path === '/v1/devices' && method === 'GET') return json(ledger.devices(bearer(req)));
      if (path === '/v1/deactivate' && method === 'POST') return json(ledger.deactivate(bearer(req), (await body(req)).deviceId));
      if (path === '/v1/trial' && method === 'POST') { const v = await body(req); return json(ledger.trial(v.deviceId, v.deviceName, trialDays)); }
      if (path === '/v1/checkout' && method === 'POST') { const v = await body(req); return json(await billing.checkout(v.offer, v.deviceId)); }
      if (path === '/v1/billing-portal' && method === 'POST') { await body(req); return json({ url: (await billing.portal(bearer(req))).url }); }
      const cancel = /^\/v1\/purchase\/([a-f0-9-]{36})\/cancel$/.exec(path); if (cancel && method === 'POST') { await body(req); return json(await billing.cancel(cancel[1], bearer(req))); }
      const purchase = /^\/v1\/purchase\/([a-f0-9-]{36})$/.exec(path); if (purchase && method === 'GET') return json(billing.collect(purchase[1], bearer(req)));
      if (method === 'GET' && ['/purchase-complete', '/purchase-cancelled'].includes(path)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(`<html lang="en"><meta charset="utf-8"><title>Orbit purchase</title><link rel="stylesheet" href="/admin/styles.css"><main><h1>${path.endsWith('complete') ? 'Return to Orbit' : 'Checkout closed'}</h1><p>${path.endsWith('complete') ? 'Open Account & License and select Check purchase. Your plan unlocks after payment confirmation.' : 'Your plan has not changed. You can return to Orbit.'}</p></main></html>`); }
      const assets = { '/admin': ['index.html', 'text/html'], '/admin/': ['index.html', 'text/html'], '/admin/app.js': ['app.js', 'text/javascript'], '/admin/styles.css': ['styles.css', 'text/css'] };
      if (method === 'GET' && assets[path]) { const [file, type] = assets[path]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(await readFile(new URL(`./public/${file}`, import.meta.url))); }
      throw problem('Not found.', 404);
    } catch (error) { if (!res.headersSent) json({ error: error.status ? error.message : 'The service could not complete this request.' }, error.status || 500); else res.end(); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  return { server, billing, ledger };
}
