const root = document.querySelector('#monitor'), bridge = window.orbitMonitor;
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let corner = 'top-right', busy = false;
async function refresh() {
  if (busy || ['INPUT','SELECT'].includes(document.activeElement.tagName)) return; busy = true;
  try {
    const { accounts, at } = await bridge.call('state'), running = accounts.filter(a => a.metrics), memory = running.reduce((sum, a) => sum + a.metrics.memoryBytes, 0), cpu = running.reduce((sum, a) => sum + a.metrics.cpu, 0);
    root.innerHTML = `<header class="row between"><strong>Orbit <span class="muted">/ Performance</span></strong><button id="restore" class="small">Back to workspace</button></header><div class="monitor-totals"><strong>${running.length}<small> / ${accounts.length} running</small></strong><span>${(memory / 1073741824).toFixed(2)} GB · ${cpu.toFixed(1)}% CPU</span></div><div class="row between"><span class="tiny muted">${running.length} processes · ${accounts.filter(a => a.health === 'alive').length} healthy</span><select id="corner" aria-label="Overlay corner">${['top-left','top-right','bottom-left','bottom-right'].map(c => `<option value="${c}" ${c === corner ? 'selected' : ''}>${c.replace('-', ' ')}</option>`).join('')}</select></div><div class="monitor-list">${accounts.map(a => `<article><div><strong>${e(a.name)}</strong><small>${a.relaunchAt ? `Relaunch in ${Math.max(0, Math.ceil((a.relaunchAt - Date.now()) / 1000))}s` : e(a.status)}</small></div><span>${a.metrics ? `${Math.round(a.metrics.memoryBytes / 1048576)} MB<br>${a.metrics.cpu.toFixed(1)}% · PID ${a.metrics.pid}` : '—'}</span></article>`).join('') || '<p>No local accounts yet.</p>'}</div><footer class="tiny muted">Refreshed ${new Date(at).toLocaleTimeString()} · local processes</footer>`;
  } catch (err) { root.textContent = err.message; } finally { busy = false; }
}
root.addEventListener('click', ev => { if (ev.target.closest('#restore')) bridge.call('monitor.restore').catch(() => {}); });
root.addEventListener('change', ev => { if (ev.target.id === 'corner') { corner = ev.target.value; bridge.call('monitor.corner', { corner }).catch(() => {}); } });
bridge?.onChange(refresh); setInterval(refresh, 3000); refresh();
