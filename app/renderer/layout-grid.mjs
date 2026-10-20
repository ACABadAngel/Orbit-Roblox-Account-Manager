export function gridSlots(ids, displayId, columns = Math.ceil(Math.sqrt(ids.length))) {
  if (!ids.length || !Number.isInteger(columns) || columns < 1 || columns > 20) return [];
  const rows = Math.ceil(ids.length / columns);
  return ids.map((accountId, i) => ({ accountId, displayId: String(displayId), x: (i % columns) / columns, y: Math.floor(i / columns) / rows, width: 1 / columns, height: 1 / rows }));
}
