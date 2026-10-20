import { createPublicKey, verify, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { entitlements, PLAN_NAMES } from './plans.mjs';
export const KEY_PATTERN = /^ORBIT-[A-F0-9]{16}(?:-[A-F0-9]{16}){3}$/;
export function serviceOrigin(value) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS service origin, or localhost for testing.');
  return url.origin;
}
export function licensePublicKey(value) {
  if (typeof value !== 'string' || value.length > 3000 || !value.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Enter the service public verification key.');
  const key = createPublicKey(value); if (key.asymmetricKeyType !== 'ed25519') throw new Error('Use an Ed25519 public verification key.'); return value.trim();
}
export function verifyReceipt(receipt, publicKey, deviceId, now = Date.now()) {
  if (typeof receipt !== 'string' || receipt.length > 15000) throw new Error('Invalid activation receipt.');
  const [payload, signature, extra] = receipt.split('.');
  if (!payload || !signature || extra || !verify(null, Buffer.from(payload), licensePublicKey(publicKey), Buffer.from(signature, 'base64url'))) throw new Error('Activation signature could not be verified.');
  const data = JSON.parse(Buffer.from(payload, 'base64url'));
  if (data.issuer !== 'orbit-license-v1' || data.deviceId !== deviceId || typeof data.licenseId !== 'string' || !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.offlineUntil) || data.issuedAt > now + 300000 || data.offlineUntil <= now || data.offlineUntil > data.issuedAt + 3 * 86400000 || (data.expiresAt !== null && (!Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now))) throw new Error('This activation has expired or belongs to a different installation.');
  const allowed = entitlements(data.plan, data.features, data.maxDevices);
  return { ...data, ...allowed };
}
export class OrbitLicenseClient {
  constructor({ store, config = {}, request = fetch, now = Date.now }) {
    this.store = store; this.request = request; this.now = now; this.error = ''; this.busy = false; this.catalog = { offers: [], trialDays: 0 }; this.lastCheck = 0;
    this.data = store.secrets.license ||= { deviceId: randomUUID(), deviceName: hostname() };
    this.data.deviceId ||= randomUUID(); this.data.deviceName ||= hostname();
    this.config = config;
  }
  get endpoint() { return this.data.serverUrl || this.config.serverUrl || ''; }
  get publicKey() { return this.data.publicKey || this.config.publicKey || ''; }
  get configured() { return Boolean(this.endpoint && this.publicKey); }
  status() {
    let granted = entitlements('free'), state = 'free', expiresAt = null, offlineUntil = null, licenseId = null;
    if (this.data.receipt && this.configured) {
      try {
        if (this.data.lastSeenAt && this.now() < this.data.lastSeenAt - 300000) throw new Error('Reconnect to verify the system clock.');
        const verified = verifyReceipt(this.data.receipt, this.publicKey, this.data.deviceId, this.now());
        granted = entitlements(verified.plan, verified.features, verified.maxDevices); state = this.error ? 'offline' : 'active'; expiresAt = verified.expiresAt; offlineUntil = verified.offlineUntil; licenseId = verified.licenseId;
      } catch { state = 'expired'; }
    }
    return { ...granted, name: PLAN_NAMES[granted.plan], state, expiresAt, offlineUntil, licenseId, configured: this.configured, serverUrl: this.endpoint, publicKey: this.publicKey, deviceId: this.data.deviceId, deviceName: this.data.deviceName, keyHint: this.data.key ? `•••• ${this.data.key.slice(-8)}` : '', error: this.error, catalog: this.catalog, pendingPurchase: Boolean(this.data.purchase) };
  }
  async api(path, body, key) {
    if (!this.configured) throw new Error('The license service has not been connected yet. Free features remain available.');
    const response = await this.request(serviceOrigin(this.endpoint) + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { Authorization: `Bearer ${key}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    const limit = 300000, chunks = []; let size = 0;
    if (response.body) for await (const chunk of response.body) { size += chunk.length; if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('Invalid service response.'); } chunks.push(chunk); }
    const result = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (!response.ok) { const error = new Error(typeof result.error === 'string' ? result.error.slice(0, 200) : 'License service request failed.'); error.status = response.status; throw error; }
    return result;
  }
  async configure({ serverUrl, publicKey }) {
    if (this.data.purchase) throw new Error('Resolve the pending purchase before changing license services.');
    const endpoint = serviceOrigin(serverUrl), key = licensePublicKey(publicKey);
    const previous = { ...this.data };
    Object.assign(this.data, { serverUrl: endpoint, publicKey: key });
    try { const meta = await this.api('/v1/info'); if (meta.publicKey !== key) throw new Error('The service public key does not match.'); }
    catch (e) { Object.keys(this.data).forEach(k => delete this.data[k]); Object.assign(this.data, previous); throw e; }
    if (previous.serverUrl !== endpoint || previous.publicKey !== key) { delete this.data.receipt; delete this.data.key; delete this.data.purchase; }
    this.error = ''; await this.store.save(); await this.loadCatalog(); return this.status();
  }
  async accept(result, key) {
    const receipt = verifyReceipt(result.receipt, this.publicKey, this.data.deviceId, this.now());
    this.data.receipt = result.receipt; if (key) this.data.key = key;
    this.data.lastSeenAt = this.now(); this.lastCheck = this.now(); this.error = ''; await this.store.save(); return receipt;
  }
  async activate(key) {
    if (!KEY_PATTERN.test(key)) throw new Error('Enter a complete Orbit activation key.');
    const result = await this.api('/v1/activate', { deviceId: this.data.deviceId, deviceName: this.data.deviceName }, key);
    await this.accept(result, key); return this.status();
  }
  async refresh() {
    if (this.busy || !this.configured || !this.data.key) return this.status(); this.busy = true;
    try { await this.accept(await this.api('/v1/refresh', { deviceId: this.data.deviceId }, this.data.key)); }
    catch (e) { this.error = e.message; if ([401, 403, 404].includes(e.status)) delete this.data.receipt; this.data.lastSeenAt = Math.max(this.data.lastSeenAt || 0, this.now()); await this.store.save(); }
    finally { this.busy = false; this.lastCheck = this.now(); }
    return this.status();
  }
  async loadCatalog() { if (this.configured) { try { this.catalog = await this.api('/v1/catalog'); } catch (e) { this.error = e.message; } } return this.catalog; }
  async trial() { const result = await this.api('/v1/trial', { deviceId: this.data.deviceId, deviceName: this.data.deviceName }); await this.accept(result, result.key); return this.status(); }
  async devices() { return this.data.key ? this.api('/v1/devices', undefined, this.data.key) : { devices: [] }; }
  async deactivate(deviceId) { const result = await this.api('/v1/deactivate', { deviceId }, this.data.key); if (deviceId === this.data.deviceId) { delete this.data.receipt; await this.store.save(); } return result; }
  async forget() { delete this.data.receipt; delete this.data.key; this.error = ''; await this.store.save(); }
  async checkout(offer) {
    if (this.data.purchase) throw new Error('Check or cancel the pending checkout before starting another purchase.');
    const result = await this.api('/v1/checkout', { offer, deviceId: this.data.deviceId });
    const url = new URL(result.url); if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Invalid checkout address.');
    this.data.purchase = { id: result.id, token: result.token }; await this.store.save(); return url.href;
  }
  async collectPurchase() {
    if (!this.data.purchase) return { paid: false };
    const p = this.data.purchase, result = await this.api(`/v1/purchase/${encodeURIComponent(p.id)}`, undefined, p.token);
    if (result.paid) { await this.activate(result.key); delete this.data.purchase; await this.store.save(); }
    if (result.cancelled) { delete this.data.purchase; await this.store.save(); }
    return { paid: Boolean(result.paid), cancelled: Boolean(result.cancelled) };
  }
  async cancelPurchase() { if (!this.data.purchase) return { cancelled: true }; const p = this.data.purchase; const result = await this.api(`/v1/purchase/${encodeURIComponent(p.id)}/cancel`, {}, p.token); if (result.paid) await this.activate(result.key); delete this.data.purchase; await this.store.save(); return result; }
  async billingPortal() { const result = await this.api('/v1/billing-portal', {}, this.data.key); const u = new URL(result.url); if (u.protocol !== 'https:' || u.hostname !== 'billing.stripe.com') throw new Error('Invalid billing portal address.'); return u.href; }
}
