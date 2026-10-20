import { randomUUID } from 'node:crypto';
import { identifier, text } from './model.mjs';
export function layout(raw, accounts) {
  if (!raw || !Array.isArray(raw.slots) || !raw.slots.length || raw.slots.length > 100) throw new Error('Choose up to 100 windows.');
  const seen = new Set();
  const slots = raw.slots.map(s => {
    identifier(s.accountId);
    if (!accounts.some(a => a.id === s.accountId) || seen.has(s.accountId)) throw new Error('Choose each account once.');
    seen.add(s.accountId);
    if (typeof s.displayId !== 'string' || s.displayId.length > 80 || ![s.x, s.y, s.width, s.height].every(Number.isFinite) || s.x < 0 || s.y < 0 || s.width < .02 || s.height < .02 || s.x + s.width > 1.001 || s.y + s.height > 1.001) throw new Error('Keep windows within their monitor.');
    return { accountId: s.accountId, displayId: s.displayId, x: s.x, y: s.y, width: s.width, height: s.height };
  });
  const gap = raw.gap ?? 8;
  if (!Number.isInteger(gap) || gap < 0 || gap > 80) throw new Error('Choose a gap between 0 and 80 pixels.');
  return { id: raw.id ? identifier(raw.id) : randomUUID(), name: text(raw.name || 'My layout', 80), gap, compact: Boolean(raw.compact), autoApply: Boolean(raw.autoApply), slots };
}
export function slotBounds(slot, display, gap = 0) {
  if (!display) throw new Error('This monitor is disconnected. Choose an available monitor.');
  const r = display.workArea;
  return { x: Math.round(r.x + slot.x * r.width + gap / 2), y: Math.round(r.y + slot.y * r.height + gap / 2), width: Math.max(32, Math.round(slot.width * r.width - gap)), height: Math.max(32, Math.round(slot.height * r.height - gap)) };
}
export { gridSlots } from '../renderer/layout-grid.mjs';
