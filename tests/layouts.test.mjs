import test from 'node:test';
import assert from 'node:assert/strict';
import { layout, gridSlots, slotBounds } from '../app/core/layouts.mjs';
import { initialState, validateSettings, validateState } from '../app/core/model.mjs';
const accounts = ['one', 'two', 'three'].map(id => ({ id }));
test('grids distribute accounts in normalized monitor space and preserve monitor identity', () => {
  const slots = gridSlots(accounts.map(a => a.id), 'left-monitor', 2);
  assert.equal(slots.length, 3); assert.deepEqual(slots[2], { accountId: 'three', displayId: 'left-monitor', x: 0, y: .5, width: .5, height: .5 });
  assert.deepEqual(gridSlots([], 'monitor'), []);
  const d = { workArea: { x: -1920, y: -300, width: 1920, height: 1040 } };
  assert.deepEqual(slotBounds(slots[0], d, 8), { x: -1916, y: -296, width: 952, height: 512 });
  assert.throws(() => slotBounds(slots[0], null), /disconnected/);
});
test('layouts reject duplicate accounts, missing accounts and invalid or off-monitor bounds', () => {
  const raw = { name: 'My windows', compact: true, autoApply: true, gap: 8, slots: gridSlots(['one', 'two'], 'monitor', 2) };
  const value = layout(raw, accounts); assert.ok(value.id); assert.equal(value.compact, true); assert.equal(value.autoApply, true);
  for (const slots of [[raw.slots[0], raw.slots[0]], [{ ...raw.slots[0], accountId: 'missing' }], [{ ...raw.slots[0], x: -.1 }], [{ ...raw.slots[0], width: 1.5 }], [{ ...raw.slots[0], height: NaN }]]) assert.throws(() => layout({ ...raw, slots }, accounts));
  assert.throws(() => layout({ ...raw, gap: -1 }, accounts));
});
test('old workspaces gain layout and video defaults and invalid audio or video settings are rejected', () => {
  const state = initialState(); delete state.layouts; delete state.settings.streamFps;
  assert.deepEqual(validateState(state).layouts, []); assert.equal(state.settings.streamFps, 60);
  assert.throws(() => validateSettings({ streamFps: 90 })); assert.throws(() => validateSettings({ streamBitrate: 100 }));
  assert.throws(() => validateSettings({ streamHeight: 1440 }));
});
