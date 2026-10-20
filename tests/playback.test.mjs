import test from 'node:test';
import assert from 'node:assert/strict';
import { videoPoint, inputEvent, streamOptions, description } from '../app/core/playback.mjs';
import { InputPump } from '../app/renderer/input-pump.mjs';
import { gather } from '../app/renderer/rtc.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('video negotiation fails clearly when the environment provides no local ICE address', async () => {
  await assert.rejects(gather({ iceGatheringState: 'complete', localDescription: { sdp: 'v=0\r\n' } }), /No local video network address/);
  await gather({ iceGatheringState: 'complete', localDescription: { sdp: 'v=0\r\na=candidate:fixture\r\n' } });
});
test('click mapping rejects letterbox bars and accounts for the displayed video aspect ratio', () => {
  const rect = { left: 100, top: 50, width: 1000, height: 1000 };
  assert.equal(videoPoint(rect, 1920, 1080, 600, 60), null);
  assert.equal(videoPoint(rect, 1920, 1080, 99, 550), null);
  assert.deepEqual(videoPoint(rect, 1920, 1080, 600, 550), { x: .5, y: .5 });
  assert.equal(videoPoint(rect, 0, 0, 600, 550), null);
});
test('click mapping handles full-window, DWM, and client-only capture on negative-coordinate monitors', () => {
  const outer = { x: -1500, y: -100, width: 1000, height: 700 }, visible = { x: -1492, y: -100, width: 984, height: 692 }, client = { x: -1492, y: -69, width: 984, height: 661 }, geometry = { outer, visible, client };
  const rect = { left: 0, top: 0, width: 1000, height: 700 };
  const x = client.x + client.width * .25 - outer.x, y = client.y + client.height * .75 - outer.y;
  assert.deepEqual(videoPoint(rect, 1000, 700, x, y, geometry), { x: .25, y: .75 });
  assert.equal(videoPoint(rect, 1000, 700, 500, 5, geometry), null, 'title bar must not click the game');
  assert.deepEqual(videoPoint({ left: 10, top: 20, width: 984, height: 661 }, 984, 661, 502, 350.5, geometry), { x: .5, y: .5 });
  assert.deepEqual(videoPoint({ left: 0, top: 0, width: 984, height: 692 }, 984, 692, 492, 31 + 661 * .5, geometry), { x: .5, y: .5 });
});
test('input validation permits scan-code keys, middle mouse and bounded relative camera movement without extra payload fields', () => {
  assert.deepEqual(inputEvent({ type: 'keydown', key: 87, hwnd: 'injected' }), { type: 'keydown', key: 87 });
  assert.deepEqual(inputEvent({ type: 'relative', dx: -24.4, dy: 10.2 }), { type: 'relative', dx: -24, dy: 10 });
  assert.equal(inputEvent({ type: 'mousedown', x: .5, y: .5, button: 1 }).button, 1);
  for (const bad of [{ type: 'keydown', key: 91 }, { type: 'relative', dx: Infinity, dy: 0 }, { type: 'relative', dx: 2001, dy: 0 }, { type: 'mousedown', x: 1.5, y: 0 }, { type: 'wheel', x: 0, y: 0, delta: NaN }, { type: 'launch' }]) assert.throws(() => inputEvent(bad));
});
test('video quality and SDP validation reject oversized or unsupported negotiation before creating a capture', () => {
  assert.deepEqual(streamOptions(), { fps: 60, height: 720, bitrate: 8, adaptive: true });
  assert.equal(streamOptions({ fps: 30, height: 1080, bitrate: 20, adaptive: false }).adaptive, false);
  for (const bad of [{ fps: 120 }, { height: 2160 }, { bitrate: 0 }, { bitrate: Infinity }]) assert.throws(() => streamOptions(bad));
  assert.throws(() => description({ type: 'offer', sdp: 'v=0' + 'a'.repeat(60000) }, 'offer'));
  assert.throws(() => description({ type: 'answer', sdp: 'v=0' }, 'offer'));
});
test('input pump preserves held-key and button ordering while coalescing motion behind a slow native call', async () => {
  const calls = []; let unblock;
  const pump = new InputPump(async v => { calls.push(structuredClone(v.event)); if (calls.length === 1) await new Promise(r => { unblock = r; }); });
  const push = event => pump.push({ leaseToken: 'one', event });
  push({ type: 'keydown', key: 87 }); push({ type: 'relative', dx: 3, dy: 4 }); push({ type: 'relative', dx: -1, dy: 2 }); push({ type: 'mousedown', button: 2 }); push({ type: 'keyup', key: 87 }); push({ type: 'mouseup', button: 2 });
  assert.equal(calls.length, 1); unblock(); await tick();
  assert.deepEqual(calls, [{ type: 'keydown', key: 87 }, { type: 'relative', dx: 2, dy: 6 }, { type: 'mousedown', button: 2 }, { type: 'keyup', key: 87 }, { type: 'mouseup', button: 2 }]);
  pump.close(); push({ type: 'keydown', key: 65 }); await tick(); assert.equal(calls.length, 5);
});
test('input pump cannot combine motion across different control leases or send queued keys after failure', async () => {
  const sent = [], errors = []; let unblock;
  const pump = new InputPump(async value => { sent.push(value); if (sent.length === 1) await new Promise(r => { unblock = r; }); else throw new Error('focus lost'); }, e => errors.push(e.message));
  pump.push({ leaseToken: 'a', event: { type: 'keydown', key: 87 } });
  pump.push({ leaseToken: 'a', event: { type: 'mousemove', x: 0, y: 0 } });
  pump.push({ leaseToken: 'b', event: { type: 'mousemove', x: 1, y: 1 } });
  assert.equal(pump.queue.length, 2); unblock(); await tick(); assert.deepEqual(errors, ['focus lost']); assert.equal(sent.length, 2); assert.equal(pump.queue.length, 0);
});
