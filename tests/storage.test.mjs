import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, encryptBackup, decryptBackup } from '../app/core/storage.mjs';
test('backup authentication rejects tampering and wrong passphrases', () => {
  const payload = { secret: 'a-private-session' }, encrypted = encryptBackup(payload, 'a good long passphrase');
  assert.equal(encrypted.includes(payload.secret), false); assert.deepEqual(decryptBackup(encrypted, 'a good long passphrase'), payload);
  assert.throws(() => decryptBackup(encrypted, 'a different passphrase'));
  const modified = JSON.parse(encrypted); modified.tag = Buffer.alloc(16).toString('base64'); assert.throws(() => decryptBackup(JSON.stringify(modified), 'a good long passphrase'));
  assert.throws(() => encryptBackup(payload, 'short'));
});
test('workspace writes serialize and vault receives secrets separately from metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-test-')); let encryptions = 0;
  const fakeCrypto = { encrypt: async s => { encryptions++; return Buffer.from(s).reverse(); }, decrypt: async b => Buffer.from(b).reverse().toString() };
  try {
    const store = await new Store(dir, fakeCrypto).load(); store.secrets.accounts = { one: 'private-session' }; const p1 = store.save(); store.state.groups.push('New'); const p2 = store.save(); await Promise.all([p1, p2]);
    assert.equal(encryptions, 2); assert.equal((await readFile(join(dir, 'workspace.json'), 'utf8')).includes('private-session'), false);
    const reopened = await new Store(dir, fakeCrypto).load(); assert.equal(reopened.secrets.accounts.one, 'private-session'); assert.ok(reopened.state.groups.includes('New'));
    await writeFile(join(dir, 'workspace.json'), '{broken'); const recovered = await new Store(dir, fakeCrypto).load(); assert.equal(recovered.state.version, 1);
  } finally { await rm(dir, { recursive: true }); }
});
test('damaged vault fails closed instead of silently dropping credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-test-'));
  try { await writeFile(join(dir, 'vault.bin'), 'broken'); await assert.rejects(new Store(dir, { decrypt: async () => { throw new Error(); } }).load(), /Cannot unlock/); }
  finally { await rm(dir, { recursive: true }); }
});
