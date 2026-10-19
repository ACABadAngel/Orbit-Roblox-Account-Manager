import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, validateSettings, validateProfile, makeLaunchUri, publicAccount, validateSchedule } from '../app/core/model.mjs';
test('settings reject shell paths, extreme concurrency, and network addresses outside supported binds', () => {
  assert.throws(() => validateSettings({ launcherPath: 'cmd.exe & echo secret' }));
  assert.throws(() => validateSettings({ maxConcurrent: 100 }));
  assert.throws(() => validateSettings({ multiSession: 'true' }));
  assert.equal(validateState({ ...initialState(), settings: { previewFps: 3 } }).settings.multiSession, true);
  assert.throws(() => validateSettings({ launchDelayMs: 0 }));
  assert.throws(() => validateSettings({ hostBind: 'evil.example' }));
  assert.equal(validateSettings({ launcherPath: 'C:\\Users\\Paul\\Froststrap.exe' }).launcherPath, 'C:\\Users\\Paul\\Froststrap.exe');
});
test('launch URI correctly encodes a specific server and excludes unvalidated input', () => {
  const p = validateProfile({ name: 'A game', placeId: '12345', jobId: 'abc-123' });
  const uri = makeLaunchUri('ticket-123', p, 1000);
  assert.ok(uri.startsWith('roblox-player:1+launchmode:play+gameinfo:ticket-123+launchtime:1000'));
  const launcher = new URL(decodeURIComponent(uri.match(/placelauncherurl:([^+]+)/)[1]));
  assert.equal(launcher.searchParams.get('request'), 'RequestGameJob'); assert.equal(launcher.searchParams.get('gameId'), 'abc-123');
  assert.throws(() => makeLaunchUri('bad+ticket:payload', p));
  assert.throws(() => validateProfile({ name: 'Bad', placeId: '123&foo=bar' }));
  assert.throws(() => makeLaunchUri('ticket', { id: 'd', name: 'Empty', placeId: '' }));
});
test('public account snapshot never includes private data or native window handles', () => {
  const a = publicAccount({ id: 'one', userId: 1, username: 'Test', displayName: 'Test', group: 'Main', cookie: 'secret', token: 'secret', window: { hwnd: '123' } });
  assert.equal(a.windowAttached, true); assert.equal('cookie' in a, false); assert.equal('token' in a, false); assert.equal('window' in a, false);
});
test('workspace validation rejects duplicate account identities and unexpected formats', () => {
  const s = initialState(); const a = { id: 'one', userId: 1, username: 'Test', displayName: 'Test', group: 'Main' }; s.accounts.push(a, { ...a });
  assert.throws(() => validateState(s)); assert.throws(() => validateState({ version: 999 }));
  assert.equal(validateState(initialState()).version, 1);
});
test('schedules require future times, real actions, and nonempty account selections', () => {
  assert.throws(() => validateSchedule({ accountIds: [], at: Date.now() + 10000, action: 'launch' }));
  assert.throws(() => validateSchedule({ accountIds: ['one'], at: Date.now() - 1000, action: 'launch' }));
  const s = validateSchedule({ accountIds: ['one', 'one'], at: Date.now() + 60000, action: 'stop', name: 'Stop' }); assert.deepEqual(s.accountIds, ['one']);
});
