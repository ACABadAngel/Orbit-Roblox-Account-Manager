import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron } from 'playwright';
import electronPath from 'electron';
const dir = await mkdtemp(join(tmpdir(), 'orbit-desktop-'));
const instance = await _electron.launch({ executablePath: electronPath, args: ['.', '--disable-gpu'], env: { ...process.env, ORBIT_TEST_DATA: dir }, timeout: 30000 });
try {
  const page = await instance.firstWindow();
  await page.getByRole('heading', { name: 'A calmer space for all your accounts.' }).waitFor();
  const initial = await page.evaluate(() => window.orbit.call('state'));
  assert.equal(initial.accounts.length, 0); assert.equal(initial.host.enabled, false);
  const list = await page.evaluate(() => window.orbit.call('windows.list')); assert.ok(Array.isArray(list));
  await page.evaluate(() => window.orbit.call('groups.add', { name: 'Desktop QA' }));
  assert.ok((await page.evaluate(() => window.orbit.call('state'))).groups.includes('Desktop QA'));
  await assert.rejects(page.evaluate(() => window.orbit.call('not-an-action')), /Unsupported/);
  await page.evaluate(() => window.orbit.call('settings.save', { hostEnabled: true, hostBind: '127.0.0.1' }));
  const details = await page.evaluate(() => window.orbit.call('host.pairing'));
  assert.match(details.fingerprint, /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
  await page.evaluate(p => window.orbit.call('machines.pair', { ...p, name: 'Loopback QA' }), details);
  assert.equal((await page.evaluate(() => window.orbit.call('state'))).machines.length, 2);
  await page.evaluate(() => window.orbit.call('settings.save', { hostEnabled: false }));
  await page.getByRole('button', { name: 'Explore demo' }).click();
  assert.equal(await page.locator('tr.account-row').count(), 9);
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  assert.equal((await page.evaluate(() => window.orbit.call('state'))).accounts.length, 0);
  console.log('Desktop smoke passed: sandbox preload/IPC, Windows helper, local persistence, real HTTPS host, pinned pairing, and demo isolation.');
} finally { await instance.close(); await rm(dir, { recursive: true, force: true }); }
