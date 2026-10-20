import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { hostname } from 'node:os';
import { entitlements, FEATURE_NAMES, PLAN_NAMES } from './plans.mjs';

export const KEYAUTH_ENDPOINT = 'https://keyauth.win/api/1.3/';
// KeyAuth's API 1.3 response verification key, not an application/seller secret.
// Source: KeyAuth/KeyAuth-Python-Example, __do_request (Ed25519).
export const KEYAUTH_PUBLIC_KEY = '5586b4bc69c7a4b487e4563a4cd96afd39140f919bd31cea7d1c6a1e8439422b';
const verificationKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(KEYAUTH_PUBLIC_KEY, 'hex')]), type: 'spki', format: 'der' });
export const KEYAUTH_SUBSCRIPTIONS = Object.freeze({ free: 'free', plus: 'plus', pro: 'pro' });

export function keyauthConfiguration(value = {}) {
  const valid = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
  if (!valid(value.name, 100) || !/^[a-zA-Z0-9]{10}$/.test(value.ownerid || '') || !valid(value.version, 30)) throw new Error('Enter the KeyAuth application name, 10-character Owner ID, and application version.');
  const subscriptions = { ...KEYAUTH_SUBSCRIPTIONS, ...value.subscriptions };
  const names = new Set();
  for (const [feature, name] of Object.entries(subscriptions)) {
    if (!['free', 'plus', 'pro', ...Object.keys(FEATURE_NAMES)].includes(feature) || !valid(name, 100) || names.has(name)) throw new Error('Use distinct KeyAuth subscription names for each plan or feature.');
    names.add(name);
  }
  return { name: value.name.trim(), ownerid: value.ownerid, version: value.version.trim(), subscriptions };
}

export function verifyKeyauthResponse(bytes, headers, now = Date.now(), key = verificationKey) {
  const signature = headers.get('x-signature-ed25519'), timestamp = headers.get('x-signature-timestamp');
  if (!/^[a-fA-F0-9]{128}$/.test(signature || '') || !/^\d{10,11}$/.test(timestamp || '') || Math.abs(now - Number(timestamp) * 1000) > 25000 || !verify(null, Buffer.concat([Buffer.from(timestamp), bytes]), key, Buffer.from(signature, 'hex'))) throw new Error('KeyAuth response verification failed. Check your clock and connection.');
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('KeyAuth returned an invalid response.'); }
  if (!data || typeof data !== 'object' || typeof data.success !== 'boolean') throw new Error('KeyAuth returned an invalid response.');
  return data;
}

export function keyauthEntitlements(info, config, hwid, now = Date.now()) {
  if (!info || info.hwid !== hwid || !Array.isArray(info.subscriptions) || info.subscriptions.length > 100) throw new Error('KeyAuth did not verify this installation. Enable HWID locking for this application.');
  const active = info.subscriptions.flatMap(s => {
    const expiry = Number(s.expiry) * 1000;
    return typeof s.subscription === 'string' && Number.isSafeInteger(expiry) && expiry > now ? [{ name: s.subscription, expiry }] : [];
  });
  const recognized = active.filter(s => Object.values(config.subscriptions).includes(s.name));
  if (!recognized.length) throw new Error('No active Orbit subscription was found. Check the key expiry and subscription names in KeyAuth.');
  const has = name => recognized.some(s => s.name === config.subscriptions[name]);
  const plan = has('pro') ? 'pro' : has('plus') ? 'plus' : 'free';
  const features = Object.fromEntries(Object.keys(FEATURE_NAMES).filter(has).map(f => [f, true]));
  // A standalone remote-control grant permits two peers, independently of activation HWID locking.
  const allowed = entitlements(plan, features, plan === 'free' && features.remoteControl ? 2 : undefined);
  // Recompute at the earliest expiry so an expired Pro/add-on cannot borrow another subscription's time.
  return { ...allowed, expiresAt: Math.min(...recognized.map(s => s.expiry)) };
}

export class KeyAuthLicenseClient {
  constructor({ store, config = {}, request = fetch, now = Date.now, verifyResponse = verifyKeyauthResponse }) {
    this.store = store; this.config = config; this.request = request; this.now = now; this.verifyResponse = verifyResponse;
    this.data = store.secrets.license ||= {};
    this.data.deviceId ||= randomUUID(); this.data.deviceName ||= hostname();
    this.error = ''; this.lastCheck = 0; this.session = ''; this.grant = null; this.verifiedUntil = 0;
    this.catalog = { offers: [], trialDays: 0 };
  }
  get settings() { return this.data.keyauth?.settings || this.config.keyauth || {}; }
  get configured() { try { keyauthConfiguration(this.settings); return true; } catch { return false; } }
  get key() { return this.data.keyauth?.key || ''; }
  get hwid() { return createHash('sha256').update('orbit:keyauth:' + this.data.deviceId).digest('hex'); }
  get refreshInterval() { return 30000; }
  status() {
    const active = this.grant && this.now() < this.verifiedUntil && this.now() >= this.checkedAt - 5000 && this.now() < this.grant.expiresAt;
    const allowed = active ? this.grant : entitlements('free');
    const settings = this.configured ? keyauthConfiguration(this.settings) : { name: '', ownerid: '', version: '1.0', subscriptions: { ...KEYAUTH_SUBSCRIPTIONS } };
    return { ...allowed, name: PLAN_NAMES[allowed.plan], provider: 'keyauth', state: active ? 'active' : this.key ? 'verification-required' : 'free', expiresAt: active ? allowed.expiresAt : null, offlineUntil: null, licenseId: active ? 'keyauth' : null, configured: this.configured, serverUrl: KEYAUTH_ENDPOINT, keyauth: settings, deviceId: this.data.deviceId, deviceName: this.data.deviceName, keyHint: this.key ? `•••• ${this.key.slice(-4)}` : '', error: this.error, catalog: this.catalog, pendingPurchase: false, capabilities: { installations: false, billing: false } };
  }
  async api(type, fields = {}, settings = this.settings) {
    const config = keyauthConfiguration(settings);
    if (this.retryAt > this.now()) throw new Error('KeyAuth is rate limiting requests. Wait before trying again.');
    let response;
    try {
      response = await this.request(KEYAUTH_ENDPOINT, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ type, ...fields, name: config.name, ownerid: config.ownerid }), signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('KeyAuth could not be reached. Paid features need an online check; Free features remain available.'); }
    if (response.status === 429) {
      const after = response.headers.get('retry-after'), seconds = /^\d+$/.test(after || '') ? Number(after) : (Date.parse(after) - this.now()) / 1000;
      this.retryAt = this.now() + Math.max(60000, Number.isFinite(seconds) ? Math.min(seconds * 1000, 3600000) : 60000);
      throw new Error('KeyAuth is rate limiting requests. Wait before trying again.');
    }
    if (!response.ok) throw new Error('KeyAuth is unavailable. Please try again later.');
    const chunks = []; let size = 0;
    if (!response.body) throw new Error('KeyAuth returned an empty response.');
    for await (const chunk of response.body) { size += chunk.length; if (size > 300000) throw new Error('KeyAuth response exceeded the size limit.'); chunks.push(chunk); }
    const data = this.verifyResponse(Buffer.concat(chunks), response.headers, this.now());
    if (data.ownerid !== undefined && data.ownerid !== config.ownerid) throw new Error('KeyAuth application owner did not match.');
    if (!data.success) {
      if (data.message === 'invalidver') throw new Error('The KeyAuth application version does not match. Check the publisher configuration.');
      // Do not display arbitrary provider text: a login error may echo the private license key.
      throw new Error('KeyAuth rejected this request. Check the application settings, key, expiry, HWID binding, or unsupported login requirements.');
    }
    return data;
  }
  async initialize(settings = this.settings) {
    if (this.session) return;
    const result = await this.api('init', { ver: keyauthConfiguration(settings).version }, settings);
    if (typeof result.sessionid !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(result.sessionid)) throw new Error('KeyAuth did not issue a valid session.');
    this.session = result.sessionid;
  }
  async configure(raw) {
    const settings = keyauthConfiguration(raw.keyauth || raw);
    if (this.data.purchase) throw new Error('Resolve the pending purchase before changing license services.');
    await this.initialize(settings);
    // Changing provider/app identity always requires fresh activation. Preserve only the installation identity.
    for (const field of ['key', 'receipt', 'serverUrl', 'publicKey', 'purchase', 'lastSeenAt']) delete this.data[field];
    this.data.provider = 'keyauth'; this.data.keyauth = { settings }; this.grant = null;
    await this.store.save(); return this.status();
  }
  async authenticate(key) {
    await this.initialize();
    const result = await this.api('license', { key, hwid: this.hwid, sessionid: this.session });
    const grant = keyauthEntitlements(result.info, keyauthConfiguration(this.settings), this.hwid, this.now());
    this.grant = grant; this.checkedAt = this.now(); this.verifiedUntil = Math.min(this.checkedAt + 60000, grant.expiresAt); this.error = '';
  }
  async activate(raw) {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!/^[\x21-\x7e]{1,100}$/.test(key)) throw new Error('Enter the complete KeyAuth license key. Keys are case-sensitive.');
    try { await this.authenticate(key); }
    catch (error) { this.grant = null; this.session = ''; this.error = error.message; throw error; }
    this.data.provider = 'keyauth'; this.data.keyauth = { settings: keyauthConfiguration(this.settings), key }; this.lastCheck = this.now();
    await this.store.save(); return this.status();
  }
  async refresh() {
    this.lastCheck = this.now();
    if (!this.configured || !this.key) return this.status();
    try {
      if (this.session) await this.api('check', { sessionid: this.session });
      await this.authenticate(this.key);
    } catch (error) { this.grant = null; this.session = ''; this.error = error.message; }
    return this.status();
  }
  async loadCatalog() { return this.catalog; }
  async forget() {
    // Clear local entitlement before waiting for the remote logout.
    this.grant = null; if (this.data.keyauth) delete this.data.keyauth.key; this.error = '';
    await this.store.save();
    const sessionid = this.session; this.session = '';
    if (sessionid) await this.api('logout', { sessionid }).catch(() => {});
  }
  async devices() { throw new Error('Manage HWID bindings in the KeyAuth dashboard or through the publisher. Removing a local key does not reset its HWID.'); }
  async deactivate() { return this.devices(); }
  async billingPortal() { throw new Error('Billing is managed by the publisher’s store. KeyAuth activation does not create a payment subscription.'); }
  async checkout() { return this.billingPortal(); }
  async trial() { throw new Error('Request a timed trial key from the publisher and activate it here.'); }
  async collectPurchase() { throw new Error('Activate the KeyAuth key delivered by your purchase.'); }
  async cancelPurchase() { return this.collectPurchase(); }
}
