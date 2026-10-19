import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPlay, playBounds } from '../app/core/local-play.mjs';
const bounds = { x: 10, y: 80, width: 640, height: 360, viewportWidth: 1000, viewportHeight: 700 };
test('local play rejects invalid or off-window surfaces before touching native windows', () => {
  for (const bad of [{ ...bounds, x: -1 }, { ...bounds, width: Infinity }, { ...bounds, height: 900 }, { ...bounds, viewportWidth: 0 }, { ...bounds, width: 0 }]) assert.throws(() => playBounds(bad));
  assert.deepEqual(playBounds({ ...bounds, hwnd: 'untrusted' }), bounds);
});
test('closing during an in-flight dock waits and restores the window', async () => {
  let finish; const calls = [];
  const p = new LocalPlay({ call: async op => { calls.push(op); if (op === 'dock') await new Promise(r => { finish = r; }); } });
  const open = p.open('one', {}, 'host', bounds);
  await new Promise(r => setImmediate(r));
  const close = p.close('one'); assert.deepEqual(calls, ['dock']);
  finish(); await open; await close;
  assert.deepEqual(calls, ['dock', 'undock']); assert.equal(p.current, null);
});
test('local play cannot steal another account window or resize a stale session', async () => {
  const calls = [], p = new LocalPlay({ call: async op => { calls.push(op); } });
  await p.open('one', {}, 'host', bounds);
  await assert.rejects(p.open('two', {}, 'host', bounds), /Close/);
  await assert.rejects(p.resize('two', bounds), /no longer/);
  await p.close('two'); assert.equal(p.current, 'one');
  await p.resize('one', bounds); await p.close(); assert.deepEqual(calls, ['dock', 'dock.resize', 'undock']);
});
test('failed docking leaves no claimed session and permits retry', async () => {
  let fail = true;
  const p = new LocalPlay({ call: async () => { if (fail) throw new Error('permission'); } });
  await assert.rejects(p.open('one', {}, 'host', bounds), /permission/); assert.equal(p.current, null);
  fail = false; await p.open('two', {}, 'host', bounds); assert.equal(p.current, 'two');
});
