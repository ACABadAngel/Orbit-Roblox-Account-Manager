import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, sign, createCipheriv, createDecipheriv, createPublicKey } from 'node:crypto';
import { entitlements } from '../app/core/plans.mjs';
import { KEY_PATTERN } from '../app/core/license-client.mjs';
export const hash = value => createHash('sha256').update(value).digest('hex');
export function problem(message, status = 400) { const error = new Error(message); error.status = status; return error; }
const clean = (v, max = 100) => { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f]/.test(v)) throw problem('Invalid text.'); return v.trim(); };
export class Ledger {
  constructor({ database = ':memory:', privateKey, now = Date.now }) {
    this.now = now; this.privateKey = privateKey; this.publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).trim();
    this.encryptionKey = createHash('sha256').update(privateKey.export({ type: 'pkcs8', format: 'der' })).digest();
    this.db = new DatabaseSync(database); this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS licenses(id TEXT PRIMARY KEY, keyHash TEXT UNIQUE NOT NULL, label TEXT NOT NULL, plan TEXT NOT NULL, features TEXT NOT NULL, maxDevices INTEGER NOT NULL, maxActivations INTEGER NOT NULL, days INTEGER, expiresAt INTEGER, activatedAt INTEGER, revoked INTEGER NOT NULL DEFAULT 0, billingBlocked INTEGER NOT NULL DEFAULT 0, customerId TEXT, subscriptionId TEXT UNIQUE, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(licenseId TEXT NOT NULL REFERENCES licenses(id), deviceId TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL, PRIMARY KEY(licenseId,deviceId));
      CREATE TABLE IF NOT EXISTS trials(deviceHash TEXT PRIMARY KEY, licenseId TEXT NOT NULL REFERENCES licenses(id));
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, tokenHash TEXT NOT NULL, deviceId TEXT NOT NULL, offer TEXT NOT NULL, licenseId TEXT NOT NULL REFERENCES licenses(id), encryptedKey TEXT NOT NULL, sessionId TEXT UNIQUE, paymentIntent TEXT, status TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, licenseId TEXT);
    `);
  }
  close() { this.db.close(); this.encryptionKey.fill(0); }
  audit(action, id) { this.db.prepare('INSERT INTO audit(at,action,licenseId) VALUES(?,?,?)').run(this.now(), action, id || null); }
  transaction(run) { this.db.exec('BEGIN IMMEDIATE'); try { const result = run(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  create({ plan = 'free', days = null, label = 'Manual key', maxActivations = 1, features = {}, maxDevices, expiresAt = null } = {}) {
    const allowed = entitlements(plan, features, maxDevices);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 36500)) throw problem('Choose 1–36500 days, or permanent.');
    if (!Number.isInteger(maxActivations) || maxActivations < 1 || maxActivations > 100) throw problem('Choose 1–100 activated installations.');
    if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now())) throw problem('Choose a future expiry date.');
    const id = randomUUID(), key = 'ORBIT-' + randomBytes(32).toString('hex').toUpperCase().match(/.{16}/g).join('-');
    this.db.prepare('INSERT INTO licenses(id,keyHash,label,plan,features,maxDevices,maxActivations,days,expiresAt,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, hash(key), clean(label), plan, JSON.stringify(allowed.features), allowed.maxDevices, maxActivations, days, expiresAt, this.now());
    this.audit('create', id); return { id, key };
  }
  findKey(key, allowInactive = false) {
    if (!KEY_PATTERN.test(key || '')) throw problem('Invalid activation key.', 401);
    const row = this.db.prepare('SELECT * FROM licenses WHERE keyHash=?').get(hash(key));
    if (!row) throw problem('Activation key was not found.', 401);
    if (!allowInactive && (row.revoked || row.billingBlocked || (row.expiresAt !== null && row.expiresAt <= this.now()))) throw problem('This license has expired, was revoked, or is awaiting payment.', 403);
    return row;
  }
  receipt(row, deviceId) {
    const issuedAt = this.now(), payload = Buffer.from(JSON.stringify({ issuer: 'orbit-license-v1', licenseId: row.id, deviceId, plan: row.plan, features: JSON.parse(row.features), maxDevices: row.maxDevices, expiresAt: row.expiresAt, issuedAt, offlineUntil: Math.min(issuedAt + 3 * 86400000, row.expiresAt ?? Infinity) })).toString('base64url');
    return `${payload}.${sign(null, Buffer.from(payload), this.privateKey).toString('base64url')}`;
  }
  activate(key, deviceId, name = 'Orbit PC', refresh = false) {
    clean(deviceId); clean(name);
    return this.transaction(() => {
      let row = this.findKey(key);
      const device = this.db.prepare('SELECT * FROM devices WHERE licenseId=? AND deviceId=?').get(row.id, deviceId);
      if (refresh && !device?.active) throw problem('This installation was deactivated. Activate your key again to use an available seat.', 403);
      if (!device?.active) {
        const count = this.db.prepare('SELECT COUNT(*) AS n FROM devices WHERE licenseId=? AND active=1').get(row.id).n;
        if (count >= row.maxActivations) throw problem('No installation slots remain. Deactivate an old installation first.', 403);
      }
      if (row.activatedAt === null) {
        const expires = row.expiresAt ?? (row.days === null ? null : this.now() + row.days * 86400000);
        this.db.prepare('UPDATE licenses SET activatedAt=?, expiresAt=? WHERE id=?').run(this.now(), expires, row.id);
        row = { ...row, activatedAt: this.now(), expiresAt: expires };
      }
      this.db.prepare('INSERT INTO devices(licenseId,deviceId,name,active,lastSeenAt) VALUES(?,?,?,1,?) ON CONFLICT(licenseId,deviceId) DO UPDATE SET name=excluded.name,active=1,lastSeenAt=excluded.lastSeenAt').run(row.id, deviceId, name, this.now());
      if (!refresh) this.audit('activate', row.id);
      return { receipt: this.receipt(row, deviceId) };
    });
  }
  devices(key) { const row = this.findKey(key, true); return { devices: this.db.prepare('SELECT deviceId,name,active,lastSeenAt FROM devices WHERE licenseId=? ORDER BY lastSeenAt DESC').all(row.id), maxActivations: row.maxActivations }; }
  deactivate(key, deviceId) { const row = this.findKey(key, true); this.db.prepare('UPDATE devices SET active=0 WHERE licenseId=? AND deviceId=?').run(row.id, clean(deviceId)); this.audit('deactivate', row.id); return { ok: true }; }
  trial(deviceId, name, days) {
    if (!days) throw problem('Trials are not enabled.', 403);
    if (this.db.prepare('SELECT 1 FROM trials WHERE deviceHash=?').get(hash(clean(deviceId)))) throw problem('This installation has already used its trial.', 403);
    const { id, key } = this.create({ plan: 'plus', days, label: 'Installation trial' });
    const activation = this.activate(key, deviceId, name); this.db.prepare('INSERT INTO trials VALUES(?,?)').run(hash(deviceId), id); return { key, ...activation };
  }
  list() { return { licenses: this.db.prepare('SELECT id,label,plan,maxDevices,maxActivations,days,expiresAt,activatedAt,revoked,billingBlocked,createdAt,(SELECT COUNT(*) FROM devices WHERE licenseId=licenses.id AND active=1) AS activations FROM licenses ORDER BY createdAt DESC LIMIT 500').all(), audit: this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all() }; }
  update(id, body) {
    const row = this.db.prepare('SELECT * FROM licenses WHERE id=?').get(clean(id)); if (!row) throw problem('License not found.', 404);
    if ('revoked' in body) { if (typeof body.revoked !== 'boolean') throw problem('Invalid revoke switch.'); this.db.prepare('UPDATE licenses SET revoked=? WHERE id=?').run(Number(body.revoked), id); }
    if ('extendDays' in body) { if (!Number.isInteger(body.extendDays) || body.extendDays < 1 || body.extendDays > 36500) throw problem('Invalid extension.'); this.db.prepare('UPDATE licenses SET expiresAt=? WHERE id=?').run(Math.max(this.now(), row.expiresAt || this.now()) + body.extendDays * 86400000, id); }
    if ('clearBillingHold' in body && body.clearBillingHold === true) this.db.prepare('UPDATE licenses SET billingBlocked=0 WHERE id=?').run(id);
    this.audit('update', id); return { ok: true };
  }
  seal(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64'); }
  unseal(value) { const b = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.encryptionKey, b.subarray(0, 12)); cipher.setAuthTag(b.subarray(12, 28)); return Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString(); }
}
