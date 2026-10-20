const $ = q => document.querySelector(q), e = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = '';
const features = { remoteControl: 'Multi-PC control', advancedSchedules: 'Recurring schedules', workflows: 'Saved workflows', extendedHistory: 'Extended history', alerts: 'Desktop alerts', crossMachineBulk: 'Cross-PC bulk actions' };
$('#features').innerHTML = Object.entries(features).map(([id, name]) => `<label>${e(name)}<select name="feature.${id}"><option value="">Plan default</option><option value="true">Allow</option><option value="false">Disable</option></select></label>`).join('');
const report = (message, error = false) => { $('#message').textContent = message; $('#message').classList.toggle('error', error); };
async function api(path, value) { const r = await fetch('/admin/api/' + path, { method: value ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(value ? { 'Content-Type': 'application/json' } : {}) }, ...(value ? { body: JSON.stringify(value) } : {}) }); const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; }
const date = value => value ? new Date(value).toLocaleString() : 'Permanent / starts on activation';
async function refresh() {
  const data = await api('licenses');
  $('#licenses').innerHTML = data.licenses.map(l => `<tr><td>${e(l.label)}</td><td>${e(l.plan)} · ${l.maxDevices} PCs</td><td>${e(date(l.expiresAt))}${!l.activatedAt && l.days ? `<br>${l.days} days from activation` : ''}</td><td>${l.activations} / ${l.maxActivations}</td><td>${l.revoked ? 'Revoked' : l.billingBlocked ? 'Payment / billing hold' : l.expiresAt && l.expiresAt < Date.now() ? 'Expired' : 'Available'}</td><td><button data-action="revoke" data-id="${l.id}" data-revoked="${l.revoked}">${l.revoked ? 'Restore' : 'Revoke'}</button><button data-action="extend" data-id="${l.id}">Extend</button><button data-action="devices" data-id="${l.id}">Installations</button>${l.billingBlocked ? `<button data-action="unblock" data-id="${l.id}">Clear billing hold</button>` : ''}</td></tr>`).join('');
  $('#audit').innerHTML = data.audit.map(a => `<div>${e(date(a.at))} · ${e(a.action)} · ${e(a.licenseId)}</div>`).join('');
}
$('#login-form').addEventListener('submit', async ev => { ev.preventDefault(); token = new FormData(ev.target).get('token'); try { await refresh(); $('#login').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false; ev.target.reset(); report('Signed in.'); } catch (err) { token = ''; report(err.message, true); } });
$('#logout').addEventListener('click', () => { token = ''; $('#workspace').hidden = true; $('#login').hidden = false; $('#logout').hidden = true; $('#key-output').value = ''; $('#new-keys').hidden = true; report('Signed out.'); });
$('#refresh').addEventListener('click', () => refresh().catch(err => report(err.message, true)));
$('#create').addEventListener('submit', async ev => {
  ev.preventDefault(); const fd = new FormData(ev.target), button = ev.target.querySelector('button'); button.disabled = true;
  try { const permissions = {}; for (const id of Object.keys(features)) if (fd.get('feature.' + id)) permissions[id] = fd.get('feature.' + id) === 'true'; const result = await api('licenses', { plan: fd.get('plan'), label: fd.get('label'), count: Number(fd.get('count')), days: fd.get('days') ? Number(fd.get('days')) : null, maxActivations: Number(fd.get('maxActivations')), features: permissions, ...(fd.get('maxDevices') ? { maxDevices: Number(fd.get('maxDevices')) } : {}) }); $('#key-output').value = result.keys.map(k => k.key).join('\n'); $('#new-keys').hidden = false; await refresh(); report('Keys created. Copy them before leaving this tab.'); }
  catch (err) { report(err.message, true); } finally { button.disabled = false; }
});
$('#copy-keys').addEventListener('click', () => navigator.clipboard.writeText($('#key-output').value).then(() => report('Keys copied.')).catch(() => { $('#key-output').select(); report('Select and copy the keys.'); }));
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-action]'); if (!b) return; b.disabled = true;
  try {
    if (b.dataset.action === 'revoke') { if (!confirm(b.dataset.revoked === '1' ? 'Restore this license?' : 'Revoke this license? Connected clients lose access on their next check.')) return; await api('licenses/' + b.dataset.id, { revoked: b.dataset.revoked !== '1' }); }
    if (b.dataset.action === 'extend') { const value = prompt('How many days should be added?', '30'); if (value === null) return; await api('licenses/' + b.dataset.id, { extendDays: Number(value) }); }
    if (b.dataset.action === 'unblock') { if (!confirm('Clear this payment/risk hold after reviewing the payment in Stripe?')) return; await api('licenses/' + b.dataset.id, { clearBillingHold: true }); }
    if (b.dataset.action === 'devices') { const result = await api(`licenses/${b.dataset.id}/devices`); $('#devices-card').hidden = false; $('#devices').innerHTML = result.devices.map(d => `<div>${e(d.name)} · ${d.active ? 'Active' : 'Inactive'} · ${e(date(d.lastSeenAt))} ${d.active ? `<button data-action="deactivate" data-id="${b.dataset.id}" data-device="${e(d.deviceId)}">Deactivate</button>` : ''}</div>`).join('') || 'No installations activated yet.'; }
    if (b.dataset.action === 'deactivate') { await api(`licenses/${b.dataset.id}/devices`, { deviceId: b.dataset.device }); b.closest('div').remove(); }
    await refresh();
  } catch (err) { report(err.message, true); } finally { b.disabled = false; }
});
