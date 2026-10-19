import https from 'node:https';
import tls from 'node:tls';
import { createHash, timingSafeEqual } from 'node:crypto';
import { generate } from 'selfsigned';

export const fingerprint = raw => createHash('sha256').update(raw).digest('hex').toUpperCase().match(/.{2}/g).join(':');
export function parsePeer(address) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter an HTTPS machine address, for example https://192.168.1.20:43128');
  return url;
}
export async function pinCertificate(address, expected) {
  const url = parsePeer(address), clean = String(expected).replace(/:/g, '').toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(clean)) throw new Error('Enter the complete SHA-256 fingerprint from the host.');
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), rejectUnauthorized: false, minVersion: 'TLSv1.2', timeout: 8000 });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate().raw;
      if (!cert || !timingSafeEqual(Buffer.from(fingerprint(cert).replace(/:/g, '')), Buffer.from(clean))) { socket.destroy(); reject(new Error('Certificate fingerprint does not match.')); return; }
      socket.end(); resolve(`-----BEGIN CERTIFICATE-----\n${cert.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
    });
    socket.once('timeout', () => socket.destroy(new Error('Connection timed out.'))); socket.once('error', reject);
  });
}
export function peerRequest(peer, secret, path, body) {
  const url = parsePeer(peer.address), payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(path, url), {
      method: payload ? 'POST' : 'GET', ca: peer.certificate, rejectUnauthorized: true, minVersion: 'TLSv1.2',
      checkServerIdentity: (_hostname, cert) => fingerprint(cert.raw) === peer.fingerprint ? undefined : new Error('Host certificate changed. Pair again.'),
      headers: { Authorization: `Bearer ${secret}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
      timeout: 10000
    }, res => {
      let data = '', bytes = 0; res.setEncoding('utf8');
      res.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 3_000_000) req.destroy(new Error('Host response too large.')); else data += chunk; });
      res.on('end', () => { try { const r = JSON.parse(data); if (res.statusCode !== 200) reject(new Error(r.error || `Host returned ${res.statusCode}.`)); else resolve(r); } catch { reject(new Error('Invalid host response.')); } });
    });
    req.on('timeout', () => req.destroy(new Error('Host did not respond.'))); req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
export async function certificate() {
  // BoringSSL (Electron) requires a CA-capable self-signed trust anchor when
  // supplied through the TLS `ca` option. This certificate is trusted only by
  // exact fingerprint in Orbit, never installed in the system certificate store.
  const cert = await generate([{ name: 'commonName', value: 'Orbit Host' }], {
    keySize: 2048, algorithm: 'sha256', days: 365,
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }
    ]
  });
  return { key: cert.private, cert: cert.cert };
}
export async function startHost({ identity, token, port, bind, route }) {
  const counts = new Map();
  const server = https.createServer({ ...identity, minVersion: 'TLSv1.2', requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    const auth = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return send(401, { error: 'Pairing token rejected.' });
    if (req.headers.origin) return send(403, { error: 'Browser requests are not allowed.' });
    const key = req.socket.remoteAddress, now = Date.now(), counter = counts.get(key) || { at: now, n: 0 };
    if (now - counter.at > 1000) { counter.at = now; counter.n = 0; } counts.set(key, counter);
    if (++counter.n > 90) return send(429, { error: 'Slow down host requests.' });
    if (counts.size > 100) counts.clear();
    try {
      let body = '', bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) { send(413, { error: 'Request too large.' }); req.destroy(); return; } body += chunk; }
      send(200, await route(req.method, req.url, body ? JSON.parse(body) : {}, key));
    } catch (e) { send(400, { error: e.message?.slice(0, 300) || 'Host request failed.' }); }
  });
  server.maxConnections = 12;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, bind, resolve); });
  return server;
}
