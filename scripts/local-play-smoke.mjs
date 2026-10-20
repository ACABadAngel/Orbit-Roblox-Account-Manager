import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright';
import electronPath from 'electron';
import { initialState } from '../app/core/model.mjs';
import { NativeHost } from '../app/core/native.mjs';
const exec = promisify(execFile), dir = await mkdtemp(join(tmpdir(), 'orbit-native-play-'));
const fixture = join(dir, 'RobloxPlayerBeta.exe');
const inspect = async hwnd => JSON.parse((await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/inspect-window.ps1'), '-Handle', hwnd])).stdout);
let instance, first, second, original, firstWindow;
const competitor = new NativeHost();
const deadline = setTimeout(() => { console.error('Native play test exceeded 90 seconds.'); instance?.process().kill(); first?.kill(); second?.kill(); competitor.worker?.kill(); process.exit(1); }, 90000);
const closeApp = async () => {
  if (!instance) return;
  const running = instance; const timer = setTimeout(() => running.process().kill(), 10000);
  try { await running.close(); } finally { clearTimeout(timer); instance = null; }
};
try {
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/window-fixture.ps1'), '-Output', fixture]);
  const state = initialState();
  state.accounts = [1, 2].map(n => ({ id: `test-${n}`, userId: n, username: `Fixture_${n}`, displayName: `Fixture ${n}`, group: 'Main', profileId: 'default', addedAt: Date.now(), status: 'idle' }));
  await mkdir(join(dir, 'orbit-data')); await writeFile(join(dir, 'orbit-data', 'workspace.json'), JSON.stringify(state));
  instance = await _electron.launch({ executablePath: electronPath, args: ['.', '--disable-gpu'], env: { ...process.env, ORBIT_TEST_DATA: dir }, timeout: 30000 });
  const page = await instance.firstWindow(); await page.locator('tr.account-row').first().waitFor();
  // Orbit owns the named mutex before the first game starts; a second owner is refused.
  await assert.rejects(competitor.call('multi.enable'), /Close ALL Roblox/);
  first = spawn(fixture); second = spawn(fixture);
  let list = [];
  for (let i = 0; i < 30; i++) { list = await page.evaluate(() => window.orbit.call('windows.list')); if ([first.pid, second.pid].every(pid => list.some(w => w.pid === pid))) break; await delay(250); }
  firstWindow = list.find(w => w.pid === first.pid); const secondWindow = list.find(w => w.pid === second.pid);
  assert.ok(firstWindow); assert.ok(secondWindow);
  assert.ok(firstWindow.memoryBytes > 0); assert.ok(Number.isFinite(firstWindow.totalCpuMs));
  console.log('Two independent fixture windows and process memory/CPU counters discovered.');
  original = await inspect(firstWindow.hwnd); assert.equal(original.parent, '0');
  for (const [id, window] of [['test-1', firstWindow], ['test-2', secondWindow]]) await page.evaluate(p => window.orbit.call('windows.attach', p), { id, window });
  await page.getByRole('button', { name: 'Live view', exact: true }).click();
  await page.locator('.previewcard [data-action="remote.open"]').first().click();
  await page.getByRole('button', { name: 'Return to preview', exact: true }).waitFor();
  console.log('Local play opened.');
  const docked = await inspect(firstWindow.hwnd); assert.notEqual(docked.parent, '0'); assert.ok(docked.width > 100);
  // A docked child stays discoverable, and the other session stays attached.
  assert.equal((await page.evaluate(() => window.orbit.call('windows.list'))).filter(w => [first.pid, second.pid].includes(w.pid)).length, 2);
  assert.equal((await page.evaluate(() => window.orbit.call('state'))).accounts.filter(a => a.windowAttached).length, 2);
  await page.setViewportSize({ width: 1100, height: 800 }); await delay(500);
  await page.getByRole('button', { name: 'Close session', exact: true }).click();
  for (let i = 0; i < 20 && (await inspect(firstWindow.hwnd)).parent !== '0'; i++) await delay(100);
  console.log('Session closed; checking native restoration.');
  const restored = await inspect(firstWindow.hwnd); assert.equal(restored.parent, '0'); assert.equal(restored.style, original.style); assert.equal(restored.width, original.width);
  await page.locator('.previewcard [data-action="remote.open"]').first().click();
  await page.getByRole('button', { name: 'Return to preview', exact: true }).waitFor();
  await closeApp();
  assert.equal((await inspect(firstWindow.hwnd)).parent, '0'); assert.equal(first.exitCode, null); assert.equal(second.exitCode, null);
  await competitor.call('multi.enable'); await competitor.call('multi.enable'); await competitor.call('multi.disable');
  console.log('Native play smoke passed: exclusive mutex ownership, two independent windows, UI embedding/resizing, child discovery, restoration on close and app exit. Test fixtures only; real Roblox gameplay is a manual check.');
} catch (error) { console.error(error); throw error; } finally {
  await closeApp(); await competitor.close(); first?.kill(); second?.kill(); await delay(300); await rm(dir, { recursive: true, force: true }); clearTimeout(deadline);
}
