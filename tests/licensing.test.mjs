import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { Ledger } from '../licensing/ledger.mjs';
import { licenseServer } from '../licensing/server.mjs';
import { LicenseClient, verifyReceipt, serviceOrigin } from '../app/core/license-client.mjs';
import { entitlements, requireFeature, requireRemote, requireBulk } from '../app/core/plans.mjs';
const pair = () => generateKeyPairSync('ed25519');
const fixture = () => { let now = Date.now(); const ledger = new Ledger({ privateKey: pair().privateKey, now: () => now }); return { ledger, now: () => now, advance: ms => { now += ms; } }; };
test('signed receipts reject forgery, copied installations, expiry, and an untrusted signing key', () => {
  const f = fixture(), grant = f.ledger.create({ plan: 'plus', days: 1 }), receipt = f.ledger.activate(grant.key, 'device-one').receipt;
  assert.equal(verifyReceipt(receipt, f.ledger.publicKey, 'device-one', f.now()).plan, 'plus');
  assert.throws(() => verifyReceipt(receipt.replace(/.$/, c => c === 'A' ? 'B' : 'A'), f.ledger.publicKey, 'device-one', f.now()));
  assert.throws(() => verifyReceipt(receipt, f.ledger.publicKey, 'device-two', f.now()));
  assert.throws(() => verifyReceipt(receipt, pair().publicKey.export({ type: 'spki', format: 'pem' }), 'device-one', f.now()));
  f.advance(86400001); assert.throws(() => verifyReceipt(receipt, f.ledger.publicKey, 'device-one', f.now())); f.ledger.close();
});
test('device slots are counted on the server, refresh cannot reclaim deactivated devices, keys are not stored in plaintext', () => {
  const f = fixture(), grant = f.ledger.create({ plan: 'pro', days: 7, maxActivations: 1 });
  assert.equal(f.ledger.db.prepare('SELECT keyHash FROM licenses').get().keyHash.includes(grant.key), false);
  f.ledger.activate(grant.key, 'one'); f.ledger.activate(grant.key, 'one');
  assert.throws(() => f.ledger.activate(grant.key, 'two'), /No installation slots/);
  f.ledger.deactivate(grant.key, 'one');
  assert.throws(() => f.ledger.activate(grant.key, 'one', 'PC', true), /deactivated/);
  f.ledger.activate(grant.key, 'two');
  assert.equal(f.ledger.devices(grant.key).devices.filter(d => d.active).length, 1); f.ledger.close();
});
test('timed keys start at activation, custom Free keys grant selected features, trial cannot repeat on the same installation', () => {
  const f = fixture(), key = f.ledger.create({ plan: 'free', days: 7, features: { remoteControl: true }, maxDevices: 1 });
  f.advance(3 * 86400000); const receipt = f.ledger.activate(key.key, 'one').receipt, payload = verifyReceipt(receipt, f.ledger.publicKey, 'one', f.now());
  assert.equal(payload.expiresAt, f.now() + 7 * 86400000); assert.equal(payload.features.remoteControl, true); assert.equal(payload.features.workflows, false);
  f.ledger.trial('trial-one', 'Trial PC', 7); assert.throws(() => f.ledger.trial('trial-one', 'Trial PC', 7), /already used/); f.ledger.close();
});
test('plan policy gates remote requests, PC limits, workflows and cross-PC launches while preserving Free local use', () => {
  const free = entitlements('free'), plus = entitlements('plus');
  assert.throws(() => requireRemote(free, 0), /Multi-PC/); requireRemote(plus, 1); assert.throws(() => requireRemote(plus, 2), /2 managed PCs/);
  requireBulk(free, ['one', 'two']); assert.throws(() => requireBulk(plus, ['one', 'peer:two']), /Bulk actions/); requireBulk(entitlements('pro'), ['one', 'peer:two']);
  assert.throws(() => requireFeature(free, 'workflows')); assert.throws(() => entitlements('plus', { inventedFeature: true }));
});
test('HTTP activation encrypts the key in the vault boundary, offline grace is bounded, and online revocation takes effect', async () => {
  const f = fixture(), grant = f.ledger.create({ plan: 'plus', days: 30 });
  const { server } = licenseServer({ ledger: f.ledger, adminToken: 'a'.repeat(64), publicUrl: 'http://127.0.0.1:8787' });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const store = { secrets: {}, save: async () => {} }, client = new LicenseClient({ store, now: f.now });
    await client.configure({ serverUrl: `http://127.0.0.1:${server.address().port}`, publicKey: f.ledger.publicKey });
    await client.activate(grant.key); assert.equal(client.status().plan, 'plus'); assert.equal(JSON.stringify(client.status()).includes(grant.key), false);
    const live = client.request; client.request = async () => { throw new Error('Offline'); };
    await client.refresh(); assert.equal(client.status().state, 'offline');
    f.advance(3 * 86400000 + 1); assert.equal(client.status().plan, 'free');
    client.request = live; await client.refresh(); assert.equal(client.status().plan, 'plus');
    f.ledger.update(grant.id, { revoked: true }); await client.refresh(); assert.equal(client.status().plan, 'free'); assert.equal(store.secrets.license.receipt, undefined);
    client.data.lastSeenAt = f.now() + 3600000; assert.equal(client.status().plan, 'free');
    const denied = await fetch(`http://127.0.0.1:${server.address().port}/admin/api/licenses`); assert.equal(denied.status, 401);
    const allowed = await fetch(`http://127.0.0.1:${server.address().port}/admin/api/licenses`, { headers: { Authorization: `Bearer ${'a'.repeat(64)}` } }); assert.equal(allowed.status, 200);
  } finally { await new Promise(r => { server.close(r); server.closeAllConnections(); }); f.ledger.close(); }
});
test('service URLs reject credential leakage, plaintext remote hosts and URL paths', () => {
  for (const value of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/api', 'https://example.com?token=secret']) assert.throws(() => serviceOrigin(value));
  assert.equal(serviceOrigin('https://example.com'), 'https://example.com');
});
