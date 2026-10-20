import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { LaunchQueue } from '../app/core/queue.mjs';
test('queue deduplicates and respects concurrency plus launch spacing', async () => {
  let now = 1000, finish; const started = [];
  const q = new LaunchQueue({ now: () => now, settings: () => ({ launchDelayMs: 5000, maxConcurrent: 1 }), launch: id => { started.push(id); return new Promise(r => finish = r); } });
  q.enqueue(['one', 'one', 'two']); await tick(); assert.deepEqual(started, ['one']); assert.deepEqual(q.snapshot.pending, ['two']);
  finish(); await tick(); assert.deepEqual(started, ['one']); now = 6000; q.pump(); await tick(); assert.deepEqual(started, ['one', 'two']); finish(); q.stop();
});
test('challenge errors pause remaining launches until user resumes', async () => {
  const q = new LaunchQueue({ settings: () => ({ launchDelayMs: 5000, maxConcurrent: 1 }), launch: async () => { throw Object.assign(new Error('Verification required'), { pauseQueue: true }); } });
  q.enqueue(['one', 'two']); await tick(); await tick(); assert.equal(q.paused, true); assert.deepEqual(q.pending, ['two']); q.stop();
});
test('stop invalidates an in-flight launch before protocol handoff', async () => {
  let check, resolve; const q = new LaunchQueue({ launch: (_id, cancelled) => { check = cancelled; return new Promise(r => resolve = r); } });
  q.enqueue(['one', 'two']); await tick(); assert.equal(check(), false); q.stop(); assert.equal(check(), true); assert.deepEqual(q.pending, []); resolve(); await tick();
});
test('cancel selected accounts invalidates their active requests without stopping other requests', async () => {
  let cancelled, resolve; const q = new LaunchQueue({ launch: (_id, c) => { cancelled = c; return new Promise(r => resolve = r); } });
  q.enqueue(['one', 'two']); await tick(); q.cancel(['one']); assert.equal(cancelled(), true); assert.deepEqual(q.pending, ['two']); q.stop(); resolve(); await tick();
});
test('group delays pace the queue and a priority relaunch cannot bypass a verification pause', async () => {
  let now = 1000, finish; const started = [];
  const q = new LaunchQueue({ now: () => now, settings: () => ({ launchDelayMs: 5000, maxConcurrent: 1 }), delayFor: id => id === 'one' ? 10000 : 0, launch: id => { started.push(id); return new Promise(r => finish = r); } });
  q.enqueue(['one', 'two', 'three']); await tick(); finish(); await tick(); assert.equal(q.nextAt,11000);
  q.pause('Verification'); q.prioritize('three'); now = 12000; q.pump(); await tick(); assert.deepEqual(started,['one']); assert.deepEqual(q.pending,['three','two']);
  q.resume(); await tick(); assert.deepEqual(started,['one','three']); q.stop(); finish(); await tick();
});
