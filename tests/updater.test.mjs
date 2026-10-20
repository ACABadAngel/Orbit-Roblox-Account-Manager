import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { UpdateManager } from '../app/core/updater.mjs';
function fixture() { const updater = new EventEmitter(); updater.checkForUpdates = async () => {}; updater.quitAndInstall = () => { updater.installed = true; }; let blocked = false; const tasks = []; const manager = new UpdateManager({ updater, available: true, version: '0.3.0', settings: () => ({ autoUpdate: true, updateChannel: 'stable' }), canInstall: async () => { if (blocked) throw new Error('Games are running'); }, schedule: fn => tasks.push(fn) }); return { updater, manager, tasks, block: value => { blocked = value; } }; }
test('updater never installs on quit and refuses to restart with active sessions', async () => {
  const { updater, manager, tasks, block } = fixture(); assert.equal(updater.autoInstallOnAppQuit, false);
  updater.emit('update-downloaded', { version: '0.3.1' }); block(true); await assert.rejects(manager.install(), /Games/); assert.equal(manager.snapshot().status, 'ready'); assert.equal(tasks.length, 0);
  block(false); await manager.install(); assert.equal(updater.installed, undefined); tasks[0](); assert.equal(updater.installed, true);
});
test('update channels never downgrade and cannot change during a download', async () => {
  const { updater, manager } = fixture(); manager.setChannel('beta'); await manager.check(); assert.equal(updater.channel, 'beta'); assert.equal(updater.allowDowngrade, false);
  updater.emit('update-available', { version: '0.4.0-beta.1' }); assert.throws(() => manager.setChannel('stable'), /Finish/);
  updater.emit('error', new Error('Internal URL with secrets')); assert.equal(manager.snapshot().error.includes('secrets'), false);
});
