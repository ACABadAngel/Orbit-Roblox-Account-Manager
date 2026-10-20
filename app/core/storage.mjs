import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { initialState, validateState } from './model.mjs';

export class Store {
  constructor(directory, crypto) { this.directory = directory; this.crypto = crypto; this.chain = Promise.resolve(); this.secrets = {}; this.state = initialState(); }
  async load() {
    await mkdir(this.directory, { recursive: true });
    try { this.state = validateState(JSON.parse(await readFile(join(this.directory, 'workspace.json'), 'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT') { try { this.state = validateState(JSON.parse(await readFile(join(this.directory, 'workspace.json.bak'), 'utf8'))); this.recovered = true; } catch { throw new Error('Orbit workspace is damaged. Restore workspace.json.bak before continuing.'); } } }
    try { this.secrets = JSON.parse(await this.crypto.decrypt(await readFile(join(this.directory, 'vault.bin')))); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot unlock the Orbit vault with this operating-system account.'); }
    for (const a of this.state.accounts) { a.status = 'idle'; delete a.window; delete a.startedAt; delete a.hasFrame; delete a.metrics; delete a.relaunchAt; delete a.recoveryAttempts; }
    return this;
  }
  save() {
    const state = JSON.stringify(this.state, null, 2), secrets = JSON.stringify(this.secrets);
    this.chain = this.chain.catch(() => {}).then(async () => {
      const encrypted = await this.crypto.encrypt(secrets);
      await writeFile(join(this.directory, 'vault.bin.tmp'), encrypted, { mode: 0o600 });
      await rename(join(this.directory, 'vault.bin.tmp'), join(this.directory, 'vault.bin'));
      if (!this.recovered) { try { await copyFile(join(this.directory, 'workspace.json'), join(this.directory, 'workspace.json.bak')); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      await writeFile(join(this.directory, 'workspace.json.tmp'), state, { mode: 0o600 });
      await rename(join(this.directory, 'workspace.json.tmp'), join(this.directory, 'workspace.json')); this.recovered = false;
    });
    return this.chain;
  }
}
export function encryptBackup(payload, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw new Error('Use a backup passphrase of at least 12 characters.');
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]); key.fill(0);
  return JSON.stringify({ format: 'orbit-backup-v1', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}
export function decryptBackup(input, passphrase) {
  if (typeof input !== 'string' || input.length > 50_000_000 || typeof passphrase !== 'string' || passphrase.length > 1024) throw new Error('Invalid backup.');
  try {
    const e = JSON.parse(input); if (e.format !== 'orbit-backup-v1') throw new Error();
    const salt = Buffer.from(e.salt, 'base64'), iv = Buffer.from(e.iv, 'base64'), tag = Buffer.from(e.tag, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error();
    const key = scryptSync(passphrase, salt, 32), decipher = createDecipheriv('aes-256-gcm', key, iv); key.fill(0); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]).toString());
  } catch { throw new Error('Wrong passphrase or damaged backup.'); }
}
