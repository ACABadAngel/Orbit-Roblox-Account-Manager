import { gridSlots } from './layout-grid.mjs';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (action, label, more = '') => `<button type="button" data-layout-action="${action}" ${more}>${label}</button>`;
export class LayoutStudio {
  constructor({ call, getState, changed, toast }) { Object.assign(this, { call, getState, changed, toast }); this.machineId = 'local'; this.data = null; this.draft = null; this.editing = true; this.images = new Map(); this.selected = null; this.displayId = ''; this.loading = false; }
  accounts() { return this.getState().accounts.filter(a => a.machineId === this.machineId || this.machineId === 'local' && !a.peerId).map(a => ({ ...a, localId: a.remoteId || a.id })); }
  async request(name, arg = {}) { return this.call(name, { ...arg, machineId: this.machineId }); }
  async load() {
    if (this.loading) return; this.loading = true;
    if (!this.getState().machines.some(m => m.id === this.machineId)) this.machineId = this.getState().machines[0]?.id || 'local';
    try {
      this.data = await this.request('layouts.state');
      if (!this.data.displays.some(d => d.id === this.displayId)) this.displayId = this.data.displays[0]?.id || '';
      if (!this.draft) this.draft = structuredClone(this.data.layouts[0] || { name: 'My layout', gap: 8, compact: true, autoApply: false, slots: gridSlots(this.accounts().filter(a => a.windowAttached).slice(0, 16).map(a => a.localId), this.displayId) });
    } catch (e) { this.data = { displays: [], layouts: [], expanded: [], error: e.message }; }
    finally { this.loading = false; this.changed(); }
  }
  markup() {
    const state = this.getState();
    if (!this.data) { this.load(); return '<header class="pagehead"><h1>Layouts</h1></header><p>Detecting monitors…</p>'; }
    const d = this.draft, monitor = this.data.displays.find(m => m.id === this.displayId);
    return `<header class="pagehead"><div><h1>Layouts</h1><p>Arrange your game windows across detected monitors.</p></div>${button('reload', 'Refresh monitors')}</header><div class="layout-toolbar"><label>Machine<select id="layout-machine">${state.machines.map(m => `<option value="${escape(m.id)}" ${m.id === this.machineId ? 'selected' : ''}>${escape(m.name)}</option>`).join('')}</select></label><label>Saved layout<select id="layout-saved"><option value="">New layout</option>${this.data.layouts.map(l => `<option value="${escape(l.id)}" ${l.id === d?.id ? 'selected' : ''}>${escape(l.name)}</option>`).join('')}</select></label>${button('new', 'New')}${button('save', 'Save layout', 'class="primary"')}${button('apply', 'Apply to windows')}${button('restore', 'Restore originals')}${d?.id ? button('delete', 'Delete') : ''}</div>${this.data.error ? `<div class="notice warning">${escape(this.data.error)}</div>` : ''}${d && monitor ? `<div class="monitor-list-tabs">${this.data.displays.map(m => button('monitor', `${escape(m.name)} · ${m.physical?.width || m.bounds.width}×${m.physical?.height || m.bounds.height} · ${Math.round(m.scaleFactor * 100)}%${m.primary ? ' · Primary' : ''}`, `data-id="${escape(m.id)}" class="${m.id === this.displayId ? 'active' : ''}"`)).join('')}</div><div class="layout-workspace"><section class="card layout-stage"><div class="row between"><strong>${escape(monitor.name)}</strong>${button('mode', this.editing ? 'Switch to live layout' : 'Edit layout')}</div><p class="help">${this.editing ? 'Drag windows to move them. Drag the lower-right handle to resize. Positions snap to 1% of the monitor.' : 'Click a window to expand or restore it. Ctrl + Shift + Backspace restores expanded windows and returns to Orbit.'}</p><canvas id="layout-canvas" width="1200" height="675" tabindex="0" aria-label="Monitor layout editor"></canvas><div id="layout-results" role="status"></div></section><aside class="card layout-options"><label>Layout name<input id="layout-name" maxlength="80" value="${escape(d.name)}"></label><div class="formgrid"><label>Columns<input id="layout-columns" type="number" min="1" max="20" value="${this.columns || 2}"></label><label>Gap (px)<input id="layout-gap" type="number" min="0" max="80" value="${d.gap}"></label></div><div class="row">${button('grid', 'Arrange grid')}${button('focus', 'Focus + sidebar')}</div><label class="checklabel"><input id="layout-compact" type="checkbox" ${d.compact ? 'checked' : ''}>Compact borderless sizing</label><p class="help">Uses direct window sizing without the normal drag minimum. Orbit reports if the game enforces a larger size. Small previews always remain available.</p><label class="checklabel"><input id="layout-auto" type="checkbox" ${d.autoApply ? 'checked' : ''}>Place windows automatically when accounts launch</label><h3>Accounts on this monitor</h3><div class="layout-accounts">${this.accounts().map(a => `<label class="checklabel"><input data-layout-account="${escape(a.localId)}" type="checkbox" ${d.slots.some(s => s.accountId === a.localId && s.displayId === this.displayId) ? 'checked' : ''}>${escape(a.alias || a.username)}${a.windowAttached ? '' : ' · offline'}</label>`).join('') || '<p>Add accounts to this machine first.</p>'}</div><div id="layout-selection"></div></aside></div>` : '<p>No monitor information is available. Select a connected machine and refresh.</p>'}`;
  }
  mount(container) {
    this.container = container; this.canvas = container.querySelector('#layout-canvas');
    container.querySelector('#layout-machine')?.addEventListener('change', e => { this.machineId = e.target.value; this.images.clear(); this.data = this.draft = null; this.changed(); });
    container.querySelector('#layout-saved')?.addEventListener('change', e => { this.draft = structuredClone(this.data.layouts.find(l => l.id === e.target.value) || { name: 'My layout', gap: 8, compact: true, autoApply: false, slots: [] }); this.selected = null; this.changed(); });
    container.querySelector('#layout-name')?.addEventListener('input', e => { this.draft.name = e.target.value; });
    container.querySelector('#layout-gap')?.addEventListener('input', e => { this.draft.gap = Number(e.target.value); this.draw(); });
    container.querySelector('#layout-columns')?.addEventListener('input', e => { this.columns = Number(e.target.value); });
    container.querySelector('#layout-compact')?.addEventListener('change', e => { this.draft.compact = e.target.checked; });
    container.querySelector('#layout-auto')?.addEventListener('change', e => { this.draft.autoApply = e.target.checked; });
    for (const input of container.querySelectorAll('[data-layout-account]')) input.addEventListener('change', () => {
      this.draft.slots = this.draft.slots.filter(s => s.accountId !== input.dataset.layoutAccount);
      if (input.checked) this.draft.slots.push({ accountId: input.dataset.layoutAccount, displayId: this.displayId, x: 0, y: 0, width: .5, height: .5 });
      this.draw();
    });
    for (const b of container.querySelectorAll('[data-layout-action]')) b.addEventListener('click', async () => { b.disabled = true; try { await this.action(b.dataset.layoutAction, b.dataset.id); } catch (e) { this.toast(e.message, true); } finally { if (b.isConnected) b.disabled = false; } });
    if (!this.canvas) return;
    const monitor = this.data.displays.find(m => m.id === this.displayId); this.canvas.height = Math.round(1200 * monitor.workArea.height / monitor.workArea.width);
    this.canvas.onpointerdown = e => {
      const point = this.point(e), slots = this.slots(), slot = [...slots].reverse().find(s => point.x >= s.x && point.y >= s.y && point.x <= s.x + s.width && point.y <= s.y + s.height);
      if (!slot) return;
      if (!this.editing) { this.expand(slot).catch(err => this.toast(err.message, true)); return; }
      this.selected = slot.accountId; this.drag = { x: point.x, y: point.y, slot, start: { ...slot }, resize: point.x > slot.x + slot.width - .035 && point.y > slot.y + slot.height - .045 };
      this.canvas.setPointerCapture(e.pointerId); this.draw(); this.selection();
    };
    this.canvas.onpointermove = e => {
      if (!this.drag) return; const p = this.point(e), { slot, start, resize } = this.drag, snap = v => Math.round(v * 100) / 100;
      if (resize) { slot.width = Math.min(1 - slot.x, Math.max(.05, snap(start.width + p.x - this.drag.x))); slot.height = Math.min(1 - slot.y, Math.max(.05, snap(start.height + p.y - this.drag.y))); }
      else { slot.x = Math.max(0, Math.min(1 - slot.width, snap(start.x + p.x - this.drag.x))); slot.y = Math.max(0, Math.min(1 - slot.height, snap(start.y + p.y - this.drag.y))); }
      this.draw(); this.selection();
    };
    this.canvas.onpointerup = this.canvas.onpointercancel = () => { this.drag = null; };
    this.canvas.onkeydown = e => { if (e.key === 'Enter' && this.selected && !this.editing) this.expand(this.slots().find(s => s.accountId === this.selected)).catch(err => this.toast(err.message, true)); };
    this.draw(); this.selection(); this.preview();
  }
  slots() { return this.draft?.slots.filter(s => s.displayId === this.displayId) || []; }
  point(e) { const r = this.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
  draw() {
    const c = this.canvas; if (!c?.isConnected) return; const ctx = c.getContext('2d'), w = c.width, h = c.height;
    ctx.fillStyle = '#090b10'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#202530'; ctx.lineWidth = 1;
    for (let i = 1; i < 20; i++) { ctx.beginPath(); ctx.moveTo(i * w / 20, 0); ctx.lineTo(i * w / 20, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * h / 20); ctx.lineTo(w, i * h / 20); ctx.stroke(); }
    for (const s of this.slots()) {
      const a = this.accounts().find(a => a.localId === s.accountId), x = s.x * w + 3, y = s.y * h + 3, width = Math.max(10, s.width * w - 6), height = Math.max(10, s.height * h - 6);
      ctx.fillStyle = '#191f2a'; ctx.fillRect(x, y, width, height);
      const image = this.images.get(s.accountId); if (image?.complete && image.naturalWidth) { const scale = Math.min(width / image.width, (height - 30) / image.height); ctx.drawImage(image, x + (width - image.width * scale) / 2, y + 30 + (height - 30 - image.height * scale) / 2, image.width * scale, image.height * scale); }
      ctx.fillStyle = '#181e29'; ctx.fillRect(x, y, width, Math.min(30, height)); ctx.save(); ctx.beginPath(); ctx.rect(x + 5, y, Math.max(0, width - 10), height); ctx.clip(); ctx.fillStyle = '#f2f4fb'; ctx.font = '16px Segoe UI'; ctx.fillText(a?.alias || a?.username || 'Unavailable account', x + 10, y + 21); ctx.restore();
      ctx.strokeStyle = this.selected === s.accountId ? '#74d6af' : '#454e60'; ctx.lineWidth = this.selected === s.accountId ? 3 : 1; ctx.strokeRect(x, y, width, height);
      if (this.editing) { ctx.fillStyle = '#74d6af'; ctx.fillRect(x + width - 12, y + height - 12, 12, 12); }
    }
  }
  selection() {
    const box = this.container?.querySelector('#layout-selection'), s = this.slots().find(s => s.accountId === this.selected); if (!box) return;
    box.replaceChildren(); if (!s) return;
    const title = document.createElement('h3'); title.textContent = 'Selected window'; box.append(title);
    for (const key of ['x', 'y', 'width', 'height']) { const label = document.createElement('label'); label.textContent = `${key} (%)`; const input = document.createElement('input'); input.type = 'number'; input.min = key === 'width' || key === 'height' ? 5 : 0; input.max = 100; input.value = Math.round(s[key] * 100); label.append(input); box.append(label); input.onchange = () => { const value = Number(input.value) / 100; if (!Number.isFinite(value)) return; s[key] = Math.max(key === 'width' || key === 'height' ? .05 : 0, Math.min(1, value)); s.x = Math.min(s.x, 1 - s.width); s.y = Math.min(s.y, 1 - s.height); this.draw(); this.selection(); }; }
    const expand = document.createElement('button'); expand.textContent = 'Expand / restore window'; expand.onclick = () => this.expand(s).catch(e => this.toast(e.message, true)); box.append(expand);
  }
  async preview() {
    if (this.previewBusy || !this.canvas?.isConnected || this.drag) return; this.previewBusy = true;
    try { for (const s of this.slots().slice(0, 12)) { const a = this.accounts().find(a => a.localId === s.accountId); if (!a?.windowAttached) continue; try { const frame = await this.call('frame', { id: a.id }); if (typeof frame?.data !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(frame.data) || frame.data.length > 2500000) continue; const image = new Image(); image.onload = () => this.draw(); image.src = frame.data; this.images.set(s.accountId, image); } catch {} } } finally { this.previewBusy = false; }
  }
  async expand(s) { if (!s) return; const r = await this.request('layouts.expand', { accountId: s.accountId, displayId: s.displayId }); this.toast(r.expanded ? 'Window expanded. Ctrl + Shift + Backspace returns it to its place.' : 'Window restored to its place.'); }
  async save() { this.draft = await this.request('layouts.save', { layout: this.draft }); this.data = await this.request('layouts.state'); this.toast('Layout saved.'); }
  results(results) { const box = this.container?.querySelector('#layout-results'); if (!box) return; box.replaceChildren(); for (const r of results) { const p = document.createElement('p'); p.className = r.ok && !r.warning ? 'help' : 'error-message'; p.textContent = `${this.accounts().find(a => a.localId === r.id)?.username || r.id}: ${r.error || r.warning || 'Applied'}`; box.append(p); } }
  async action(action, id) {
    if (action === 'reload') return this.load();
    if (action === 'monitor') { this.displayId = id; this.selected = null; this.changed(); return; }
    if (action === 'mode') { this.editing = !this.editing; this.changed(); return; }
    if (action === 'new') { this.draft = { name: 'My layout', gap: 8, compact: true, autoApply: false, slots: [] }; this.changed(); return; }
    if (action === 'grid' || action === 'focus') {
      const ids = this.slots().map(s => s.accountId); if (!ids.length) throw new Error('Select accounts for this monitor first.');
      let slots = gridSlots(ids, this.displayId, this.columns || 2);
      if (action === 'focus' && ids.length > 1) slots = [{ accountId: ids[0], displayId: this.displayId, x: 0, y: 0, width: .7, height: 1 }, ...gridSlots(ids.slice(1), this.displayId, 1).map(s => ({ ...s, x: .7, width: .3 }))];
      this.draft.slots = [...this.draft.slots.filter(s => s.displayId !== this.displayId), ...slots]; this.draw(); return;
    }
    if (action === 'save') { await this.save(); this.changed(); return; }
    if (action === 'apply') { await this.save(); this.results(await this.request('layouts.apply', { layoutId: this.draft.id })); return; }
    if (action === 'restore') { this.results(await this.request('layouts.restore')); return; }
    if (action === 'delete') { await this.request('layouts.remove', { layoutId: this.draft.id }); this.draft = null; await this.load(); }
  }
}
