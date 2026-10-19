import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { certificate, fingerprint, pinCertificate, peerRequest, startHost, parsePeer } from '../app/core/remote.mjs';
test('pairing rejects credential-bearing, non-HTTPS and path-based addresses', () => {
  for (const url of ['http://localhost:1234', 'https://user:pass@localhost', 'https://localhost/command', 'https://localhost/?token=secret']) assert.throws(() => parsePeer(url));
});
test('paired HTTPS authenticates, pins certificates, and rejects a wrong token or fingerprint', async () => {
  const identity = await certificate(), token = 'test-token';
  const host = await startHost({ identity, token, port: 0, bind: '127.0.0.1', route: async (method, path) => ({ method, path, accounts: [] }) });
  try {
    const address = `https://127.0.0.1:${host.address().port}`, fp = fingerprint(new X509Certificate(identity.cert).raw);
    const cert = await pinCertificate(address, fp); const peer = { address, certificate: cert, fingerprint: fp };
    assert.deepEqual(await peerRequest(peer, token, '/state'), { method: 'GET', path: '/state', accounts: [] });
    await assert.rejects(peerRequest(peer, 'wrong-token', '/state'), /rejected/);
    await assert.rejects(pinCertificate(address, '00'.repeat(32)), /does not match/);
    const other = await certificate(); await assert.rejects(peerRequest({ ...peer, certificate: other.cert }, token, '/state'));
  } finally { host.closeAllConnections(); await new Promise(r => host.close(r)); }
});
