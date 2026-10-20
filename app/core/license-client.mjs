import { OrbitLicenseClient } from './orbit-license-client.mjs';
import { KeyAuthLicenseClient } from './keyauth-client.mjs';
export { KEY_PATTERN, serviceOrigin, licensePublicKey, verifyReceipt } from './orbit-license-client.mjs';

// Keep the same main-process interface and feature gates for both providers.
export class LicenseClient {
  constructor(options) {
    this.options = options;
    const saved = options.store.secrets.license;
    const provider = saved?.provider || (saved?.serverUrl ? 'orbit' : options.config?.provider || 'orbit');
    this.client = this.make(provider); this.busy = false;
  }
  make(provider) {
    if (!['orbit', 'keyauth'].includes(provider)) throw new Error('Unknown license provider.');
    return new (provider === 'keyauth' ? KeyAuthLicenseClient : OrbitLicenseClient)(this.options);
  }
  get data() { return this.client.data; }
  get request() { return this.client.request; }
  set request(value) { this.client.request = value; this.options.request = value; }
  get lastCheck() { return this.client.lastCheck; }
  get refreshInterval() { return this.client.refreshInterval || 6 * 3600000; }
  status() { return { provider: 'orbit', capabilities: { installations: true, billing: true }, ...this.client.status() }; }
  async locked(operation, skip = false) {
    if (this.busy) { if (skip) return this.status(); throw new Error('Wait for the current license request to finish.'); }
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  async configure(raw) {
    return this.locked(async () => {
      const provider = raw.provider || (raw.serverUrl ? 'orbit' : 'keyauth');
      const previous = structuredClone(this.data), candidate = this.make(provider);
      try {
        await candidate.configure(raw);
        if (provider === 'orbit') { candidate.data.provider = 'orbit'; delete candidate.data.keyauth; await candidate.store.save(); }
        this.client = candidate; return this.status();
      } catch (error) {
        for (const field of Object.keys(this.data)) delete this.data[field];
        Object.assign(this.data, previous); throw error;
      }
    });
  }
  activate(...args) { return this.locked(() => this.client.activate(...args)); }
  refresh() { return this.locked(() => this.client.refresh(), true); }
  loadCatalog() { return this.locked(() => this.client.loadCatalog(), true); }
  forget() { return this.locked(() => this.client.forget()); }
  devices() { return this.locked(() => this.client.devices()); }
  deactivate(...args) { return this.locked(() => this.client.deactivate(...args)); }
  trial() { return this.locked(() => this.client.trial()); }
  checkout(...args) { return this.locked(() => this.client.checkout(...args)); }
  billingPortal() { return this.locked(() => this.client.billingPortal()); }
  collectPurchase() { return this.locked(() => this.client.collectPurchase()); }
  cancelPurchase() { return this.locked(() => this.client.cancelPurchase()); }
}
