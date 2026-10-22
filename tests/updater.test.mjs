import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { priceLabel } from '../app/renderer/license-views.mjs';
import { UpdateManager } from '../app/core/updater.mjs';
function fixture() {
  const updater = new EventEmitter(); let blocked = false;
  updater.checkForUpdates = async () => { updater.checks = (updater.checks || 0) + 1; updater.emit('update-available', { version: '0.6.0' }); };
  updater.downloadUpdate = async () => { updater.downloads = (updater.downloads || 0) + 1; updater.emit('update-downloaded', { version: '0.6.0' }); };
  updater.quitAndInstall = (...args) => { updater.installArgs = args; };
  const tasks = [], manager = new UpdateManager({ updater, available: true, version: '0.5.0', settings: () => ({ autoUpdate: true, updateChannel: 'stable' }), canInstall: async () => { if (blocked) throw new Error('Games are running'); }, schedule: fn => tasks.push(fn) });
  return { updater, manager, tasks, block: value => { blocked = value; } };
}
test('startup only offers an update; Not now never downloads or installs on quit', async () => {
  const { updater, manager, tasks } = fixture();
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  await manager.check(); assert.equal(manager.snapshot().status, 'available'); manager.defer();
  assert.equal(updater.downloads, undefined); assert.equal(tasks.length, 0);
});
test('one Update click downloads, persists, and silently installs with automatic reopen', async () => {
  const { updater, manager, tasks } = fixture(); let persisted = false; manager.prepareInstall = async () => { persisted = true; };
  await manager.check(); await manager.start();
  assert.equal(updater.downloads, 1); assert.equal(persisted, true); assert.equal(tasks.length, 1);
  assert.equal(manager.snapshot().status, 'installing'); tasks[0](); assert.deepEqual(updater.installArgs, [true, true]);
});
test('active sessions block restart after download, and Update retries the cached download', async () => {
  const { updater, manager, tasks, block } = fixture(); await manager.check(); block(true); await manager.start();
  assert.equal(manager.snapshot().status, 'ready'); assert.match(manager.snapshot().error, /Games/); assert.equal(tasks.length, 0);
  block(false); await manager.start(); assert.equal(updater.downloads, 1); assert.equal(tasks.length, 1);
});
test('deferring during download revokes restart consent, including duplicate Update clicks', async () => {
  const { updater, manager, tasks } = fixture(); let finish;
  updater.downloadUpdate = () => new Promise(resolve => { finish = () => { updater.emit('update-downloaded', { version: '0.6.0' }); resolve(); }; });
  await manager.check(); const download = manager.start();
  await assert.rejects(manager.start(), /No update/); manager.defer(); finish(); await download;
  assert.equal(manager.snapshot().status, 'ready'); assert.equal(tasks.length, 0);
});
test('Not now during the asynchronous session safety check cancels the restart', async () => {
  const { updater, manager, tasks } = fixture(); let finish;
  manager.canInstall = () => new Promise(resolve => { finish = resolve; }); updater.emit('update-downloaded', { version: '0.6.0' });
  const install = manager.start(); manager.defer(); finish(); await install; assert.equal(tasks.length, 0); assert.equal(manager.snapshot().status, 'ready');
});
test('failed downloads can retry, never expose internal errors, and retain the current version', async () => {
  const { updater, manager, tasks } = fixture(); await manager.check(); const download = updater.downloadUpdate;
  updater.downloadUpdate = async () => { updater.emit('error', new Error('Internal secret URL')); throw new Error('Internal secret URL'); };
  await manager.start(); assert.equal(manager.snapshot().status, 'error'); assert.equal(manager.snapshot().version, '0.5.0'); assert.doesNotMatch(manager.snapshot().error, /secret/); assert.equal(tasks.length, 0);
  updater.downloadUpdate = download; await manager.start(); assert.equal(tasks.length, 1);
});
test('update channels never downgrade, discard old offers, and cannot change during download', async () => {
  const { updater, manager } = fixture(); manager.setChannel('beta'); await manager.check(); assert.equal(updater.channel, 'beta'); assert.equal(updater.allowDowngrade, false);
  manager.setChannel('stable'); assert.equal(manager.snapshot().nextVersion, '');
  await manager.check(); updater.emit('download-progress', { percent: 25 }); assert.throws(() => manager.setChannel('beta'), /Finish/);
  updater.emit('error', new Error('Internal URL with secrets')); assert.doesNotMatch(manager.snapshot().error, /secrets/);
});
test('portable and source builds cannot start automatic updates', async () => {
  const { manager } = fixture(); manager.available = false;
  await assert.rejects(manager.check(), /installed Windows app/); await assert.rejects(manager.start(), /No update/);
});

test('purchase labels preserve Stripe charge units, including zero-decimal currencies and legacy exceptions', () => {
  assert.equal(priceLabel(500, 'eur'), new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(5));
  assert.equal(priceLabel(500, 'jpy'), new Intl.NumberFormat(undefined, { style: 'currency', currency: 'JPY' }).format(500));
  assert.equal(priceLabel(500, 'ugx'), new Intl.NumberFormat(undefined, { style: 'currency', currency: 'UGX' }).format(5));
});
