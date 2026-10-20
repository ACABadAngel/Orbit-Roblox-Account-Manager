import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { LicenseClient } from '../app/core/license-client.mjs';
import { KEYAUTH_ENDPOINT, keyauthConfiguration, keyauthEntitlements, verifyKeyauthResponse } from '../app/core/keyauth-client.mjs';
import { requireFeature, requireRemote } from '../app/core/plans.mjs';
import { licensePage } from '../app/renderer/license-views.mjs';

const settings = { name: 'Orbit test', ownerid: 'abcdefghij', version: '1.0' };
const config = { provider: 'keyauth', keyauth: settings };
function fixture() {
  const pair = generateKeyPairSync('ed25519'); let now = Date.now();
  const f = { calls: [], plan: 'plus', offline: false, denied: false, wrongHwid: false, unsigned: false, stale: false, huge: false, saves: 0,
    now: () => now, advance: ms => { now += ms; }, store: { secrets: {}, save: async () => { f.saves++; } } };
  f.response = data => {
    const body = Buffer.from(JSON.stringify(data)), timestamp = String(Math.floor((now - (f.stale ? 60000 : 0)) / 1000));
    const signature = sign(null, Buffer.concat([Buffer.from(timestamp), body]), pair.privateKey).toString('hex');
    return new Response(body, { headers: f.unsigned ? {} : { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp } });
  };
  f.request = async (url, options) => {
    const form = Object.fromEntries(options.body); f.calls.push({ url, options, form });
    assert.equal(url, KEYAUTH_ENDPOINT); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(form.name, settings.name); assert.equal(form.ownerid, settings.ownerid);
    assert.equal(form.secret, undefined); assert.equal(form.sellerkey, undefined);
    if (f.offline) throw new Error('Disconnected');
    if (f.huge) return new Response('x'.repeat(300001));
    if (f.denied && form.type !== 'init') return f.response({ success: false, message: 'Secret echoed by provider: ' + form.key });
    if (form.type === 'init') return f.response({ success: true, ownerid: settings.ownerid, sessionid: 'session-1' });
    if (form.type === 'license') return f.response({ success: true, ownerid: settings.ownerid, info: { username: form.key, hwid: f.wrongHwid ? 'another-device' : form.hwid, subscriptions: [{ subscription: f.plan, expiry: String(Math.floor(now / 1000) + 3600) }] } });
    return f.response({ success: true, ownerid: settings.ownerid });
  };
  f.verifyResponse = (bytes, headers, time) => verifyKeyauthResponse(bytes, headers, time, pair.publicKey);
  f.client = new LicenseClient({ store: f.store, config, request: f.request, now: f.now, verifyResponse: f.verifyResponse });
  return f;
}

test('KeyAuth verifies signatures and both directions of timestamp freshness before accepting JSON', () => {
  const pair = generateKeyPairSync('ed25519'), now = Date.now(), timestamp = String(Math.floor(now / 1000));
  const bytes = Buffer.from('{"success":true}'), signature = sign(null, Buffer.concat([Buffer.from(timestamp), bytes]), pair.privateKey).toString('hex');
  const headers = new Headers({ 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp });
  assert.equal(verifyKeyauthResponse(bytes, headers, now, pair.publicKey).success, true);
  for (const time of [now + 26000, now - 26000]) assert.throws(() => verifyKeyauthResponse(bytes, headers, time, pair.publicKey));
  assert.throws(() => verifyKeyauthResponse(Buffer.from('{"success":false}'), headers, now, pair.publicKey));
  assert.throws(() => verifyKeyauthResponse(bytes, new Headers(), now, pair.publicKey));
  assert.throws(() => verifyKeyauthResponse(bytes, headers, now, generateKeyPairSync('ed25519').publicKey));
});

test('KeyAuth activation preserves key case, gates peer PCs, and keeps private values out of snapshots', async () => {
  const f = fixture(), key = 'Orbit-LowerCase-aB123';
  assert.equal(f.client.status().plan, 'free');
  await f.client.activate(key);
  const status = f.client.status();
  assert.equal(status.plan, 'plus'); assert.equal(status.maxDevices, 2); assert.equal(status.offlineUntil, null);
  requireRemote(status, 1); assert.throws(() => requireRemote(status, 2)); assert.throws(() => requireFeature(status, 'crossMachineBulk'));
  assert.equal(f.calls[1].form.key, key); assert.equal(f.calls[1].form.hwid.length, 64);
  assert.equal(JSON.stringify(status).includes(key), false); assert.equal(JSON.stringify(status).includes('session-1'), false);
  assert.equal(f.store.secrets.license.keyauth.key, key);
  await f.client.refresh(); assert.deepEqual(f.calls.map(c => c.form.type), ['init', 'license', 'check', 'license']);
  assert.equal(f.calls.filter(c => c.form.type === 'init').length, 1);
});

test('expired, unknown, forged, mismatched, and oversized KeyAuth responses cannot unlock features', async () => {
  for (const mode of ['wrongHwid', 'unsigned', 'stale', 'huge']) {
    const f = fixture(); f[mode] = true;
    await assert.rejects(f.client.activate('test-key')); assert.equal(f.client.status().plan, 'free');
    assert.equal(f.store.secrets.license.keyauth?.key, undefined);
  }
  const f = fixture(); f.plan = 'admin'; await assert.rejects(f.client.activate('test-key'), /subscription/);
  const c = keyauthConfiguration(settings), time = Date.now();
  assert.throws(() => keyauthEntitlements({ hwid: 'test', subscriptions: [{ subscription: 'pro', expiry: (time - 1000) / 1000 }] }, c, 'test', time));
});

test('a network failure or denied session removes paid access and never echoes a license in errors', async () => {
  const f = fixture(), key = 'private-Key-AbCd'; await f.client.activate(key);
  f.offline = true; await f.client.refresh(); assert.equal(f.client.status().plan, 'free');
  assert.equal(f.client.status().state, 'verification-required');
  f.offline = false; await f.client.refresh(); assert.equal(f.client.status().plan, 'plus');
  f.denied = true; await f.client.refresh(); assert.equal(f.client.status().plan, 'free');
  assert.equal(JSON.stringify(f.client.status()).includes(key), false);
  await assert.rejects(f.client.activate(key), error => !error.message.includes(key));
});

test('no saved KeyAuth grant survives restart, stale time, clock rollback, or local removal', async () => {
  const f = fixture(); await f.client.activate('private-Key');
  const restarted = new LicenseClient({ store: f.store, config, now: f.now, request: f.request, verifyResponse: f.verifyResponse });
  assert.equal(restarted.status().plan, 'free'); await restarted.refresh(); assert.equal(restarted.status().plan, 'plus');
  f.advance(60001); assert.equal(restarted.status().plan, 'free');
  await restarted.refresh(); assert.equal(restarted.status().plan, 'plus');
  f.advance(-10000); assert.equal(restarted.status().plan, 'free');
  await restarted.forget(); assert.equal(restarted.status().keyHint, '');
  assert.equal(f.store.secrets.license.keyauth.key, undefined); assert.equal(f.calls.at(-1).form.type, 'logout');
});

test('Pro and individual feature subscriptions combine without borrowing an expired subscription’s access', () => {
  const time = Date.now(), c = keyauthConfiguration({ ...settings, subscriptions: { remoteControl: 'remote-only', workflows: 'workflow-only' } });
  const info = subscriptions => ({ hwid: 'test', subscriptions });
  const grant = keyauthEntitlements(info([{ subscription: 'pro', expiry: (time + 2000) / 1000 }, { subscription: 'plus', expiry: (time + 100000) / 1000 }]), c, 'test', time);
  assert.equal(grant.plan, 'pro'); assert.equal(grant.expiresAt, time + 2000);
  const later = keyauthEntitlements(info([{ subscription: 'pro', expiry: (time + 2000) / 1000 }, { subscription: 'plus', expiry: (time + 100000) / 1000 }]), c, 'test', time + 3000);
  assert.equal(later.plan, 'plus'); assert.equal(later.features.crossMachineBulk, false);
  const custom = keyauthEntitlements(info([{ subscription: 'remote-only', expiry: (time + 2000) / 1000 }, { subscription: 'workflow-only', expiry: (time + 3000) / 1000 }]), c, 'test', time);
  assert.equal(custom.plan, 'free'); assert.equal(custom.maxDevices, 2); requireFeature(custom, 'workflows'); requireRemote(custom, 1);
});

test('bad or duplicate configuration is rejected, provider switches require fresh activation, and pending purchases are protected', async () => {
  for (const raw of [{ ...settings, ownerid: 'bad' }, { ...settings, subscriptions: { plus: 'pro' } }, { ...settings, subscriptions: { arbitrary: 'something' } }]) assert.throws(() => keyauthConfiguration(raw));
  const f = fixture(); await f.client.activate('private-Key');
  const before = structuredClone(f.client.data); f.unsigned = true;
  await assert.rejects(f.client.configure({ provider: 'keyauth', keyauth: settings }));
  assert.deepEqual(f.client.data, before); assert.equal(f.client.status().plan, 'plus');
  f.unsigned = false;
  await f.client.configure({ provider: 'keyauth', keyauth: settings }); assert.equal(f.client.status().plan, 'free'); assert.equal(f.client.status().keyHint, '');
  f.client.data.purchase = { id: 'pending', token: 'private' };
  await assert.rejects(f.client.configure({ provider: 'keyauth', keyauth: settings }), /pending purchase/);
});

test('overlapping mutation cannot let a late activation restore a removed or switched key', async () => {
  const f = fixture(), original = f.client.request; let release;
  f.client.request = async (...args) => { await new Promise(resolve => { release = resolve; }); f.client.request = original; return original(...args); };
  const activating = f.client.activate('private-Key');
  await assert.rejects(f.client.forget(), /current license request/);
  await assert.rejects(f.client.configure({ provider: 'keyauth', keyauth: settings }), /current license request/);
  assert.equal((await f.client.refresh()).plan, 'free');
  release(); await activating;
  await f.client.forget(); assert.equal(f.client.status().plan, 'free');
});

test('KeyAuth UI shows online activation, hides unsupported checkout/billing/installations, and escapes application names', async () => {
  const f = fixture(); await f.client.activate('private-Key');
  const status = f.client.status(); status.keyauth.name = '<script>bad</script>';
  const html = licensePage({ license: status }, false);
  assert.match(html, /KeyAuth checks paid access online/); assert.match(html, /&lt;script&gt;/);
  for (const action of ['license.checkout', 'license.billing', 'license.devices', 'license.trial']) assert.ok(!html.includes(`data-action="${action}"`), action);
  for (const method of ['devices', 'billingPortal', 'trial', 'checkout']) await assert.rejects(f.client[method]());
});

test('unconfigured KeyAuth stays Free, cannot submit an activation, and exposes no invented app identity', async () => {
  const store = { secrets: {}, save: async () => {} }; let calls = 0;
  const client = new LicenseClient({ store, config: { provider: 'keyauth' }, request: async () => { calls++; } });
  assert.equal(client.status().configured, false); assert.equal(client.status().plan, 'free');
  await assert.rejects(client.activate('private-Key'), /application name/); assert.equal(calls, 0);
});

test('HTTP rate limiting honors Retry-After and does not keep calling KeyAuth during cooldown', async () => {
  const f = fixture(); await f.client.activate('private-Key');
  let calls = 0;
  f.client.request = async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); };
  await f.client.refresh(); assert.equal(f.client.status().plan, 'free');
  f.advance(60000); await f.client.refresh(); assert.equal(calls, 1);
  f.advance(60001); await f.client.refresh(); assert.equal(calls, 2);
});
