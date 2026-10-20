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
const deadline = setTimeout(() => { console.error('Native play test exceeded 140 seconds.'); instance?.process().kill(); first?.kill(); second?.kill(); competitor.worker?.kill(); process.exit(1); }, 140000);
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
  assert.equal(await page.evaluate(() => window.orbit.call('play.focus', { id: 'test-1' })), true);
  await competitor.call('input', { window: firstWindow, event: { type: 'keydown', key: 87 } });
  await delay(150);
  assert.equal((await competitor.call('list')).find(w => w.pid === first.pid).title, 'Key W');
  await competitor.call('input', { window: firstWindow, event: { type: 'keyup', key: 87 } });
  // A docked child stays discoverable, and the other session stays attached.
  assert.equal((await page.evaluate(() => window.orbit.call('windows.list'))).filter(w => [first.pid, second.pid].includes(w.pid)).length, 2);
  assert.equal((await page.evaluate(() => window.orbit.call('state'))).accounts.filter(a => a.windowAttached).length, 2);
  await page.setViewportSize({ width: 1100, height: 800 }); await delay(500);
  await page.getByRole('button', { name: 'Close session', exact: true }).click();
  for (let i = 0; i < 20 && (await inspect(firstWindow.hwnd)).parent !== '0'; i++) await delay(100);
  console.log('Session closed; checking native restoration.');
  const restored = await inspect(firstWindow.hwnd); assert.equal(restored.parent, '0'); assert.equal(restored.style, original.style); assert.equal(restored.width, original.width);
  const layoutState = await page.evaluate(() => window.orbit.call('layouts.state'));
  assert.ok(layoutState.displays.length); const displayId = layoutState.displays[0].id;
  const savedLayout = await page.evaluate(displayId => window.orbit.call('layouts.save', { layout: { name: 'Fixture grid', compact: true, gap: 8, slots: [{ accountId: 'test-1', displayId, x: 0, y: 0, width: .4, height: .5 }, { accountId: 'test-2', displayId, x: .4, y: 0, width: .4, height: .5 }] } }), displayId);
  const applied = await page.evaluate(layoutId => window.orbit.call('layouts.apply', { layoutId }), savedLayout.id);
  assert.ok(applied.every(r => r.ok));
  const arranged = await inspect(firstWindow.hwnd);
  assert.equal((await page.evaluate(displayId => window.orbit.call('layouts.expand', { accountId: 'test-1', displayId }), displayId)).expanded, true);
  assert.equal((await page.evaluate(displayId => window.orbit.call('layouts.expand', { accountId: 'test-1', displayId }), displayId)).expanded, false);
  const afterExpand = await inspect(firstWindow.hwnd); assert.equal(afterExpand.width, arranged.width); assert.equal(afterExpand.style, arranged.style);
  await page.evaluate(() => window.orbit.call('layouts.restore'));
  assert.equal((await inspect(firstWindow.hwnd)).style, original.style);
  const audio = await page.evaluate(() => window.orbit.call('audio.set', { ids: ['test-1','test-2'], audio: { volume: .2, muted: true } }));
  assert.ok(audio.every(r => r.ok));
  assert.ok((await page.evaluate(() => window.orbit.call('state'))).accounts.every(a => a.audio.volume === .2 && a.audio.muted));
  // Hit a known client coordinate and verify the window received it there.
  await competitor.call('focus', { window: firstWindow });
  await competitor.call('input', { window: firstWindow, event: { type: 'mousedown', button: 0, x: .25, y: .75 } });
  await competitor.call('input', { window: firstWindow, event: { type: 'mouseup', button: 0, x: .25, y: .75 } });
  await delay(150); assert.match((await competitor.call('list')).find(w => w.pid === first.pid).title, /^Click /);
  console.log('Docked keyboard input, native mouse clicks, monitor layouts, expand/restore and per-process audio RPC passed.');
  // Capture the real fixture HWND through the production hidden renderer and
  // decode a real WebRTC stream. A 60 FPS request is not a benchmark guarantee.
  await page.evaluate(async () => {
    const { RemoteVideo } = await import('./remote-video.mjs');
    const surface = document.createElement('div'); document.body.append(surface);
    window.videoErrors = [];
    window.qaVideo = new RemoteVideo({ call: (name, arg) => window.orbit.call(name, arg), id: 'test-1', surface, diagnostics: null, onError: message => window.videoErrors.push(message) });
    await window.qaVideo.start({ fps: 60, height: 720, bitrate: 8, adaptive: true });
    if (window.videoErrors.length) throw new Error(window.videoErrors.join('; '));
  });
  await page.waitForFunction(() => window.qaVideo.ready && window.qaVideo.video?.videoWidth > 0, undefined, { timeout: 25000 });
  const streamInfo = await page.evaluate(async () => {
    const stats = await window.qaVideo.connection.getStats();
    return { errors: window.videoErrors, video: [...stats.values()].filter(s => s.type === 'inbound-rtp' && s.kind === 'video').map(s => ({ frames: s.framesDecoded, width: s.frameWidth, height: s.frameHeight })) };
  });
  assert.deepEqual(streamInfo.errors, []); assert.ok(streamInfo.video.some(s => s.frames > 0));
  await page.evaluate(async () => { const surface = window.qaVideo.surface; await window.qaVideo.stop(); surface.remove(); });
  console.log('Production window capture, HTTPS-style SDP handoff and real WebRTC video decoding passed at a requested 60 FPS.');
  await page.locator('.previewcard [data-action="remote.open"]').first().click();
  await page.getByRole('button', { name: 'Return to preview', exact: true }).waitFor();
  await closeApp();
  assert.equal((await inspect(firstWindow.hwnd)).parent, '0'); assert.equal(first.exitCode, null); assert.equal(second.exitCode, null);
  await competitor.call('multi.enable'); await competitor.call('multi.enable'); await competitor.call('multi.disable');
  console.log('Native play smoke passed: exclusive mutex ownership, two independent windows, UI embedding/resizing, child discovery, restoration on close and app exit. Test fixtures only; real Roblox gameplay is a manual check.');
} catch (error) { console.error(error); throw error; } finally {
  await closeApp(); await competitor.close(); first?.kill(); second?.kill(); await delay(300); await rm(dir, { recursive: true, force: true }); clearTimeout(deadline);
}
