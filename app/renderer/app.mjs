import { icon, logo } from './icons.mjs';
import { licensePage, updatesPage, workflowsPage } from './license-views.mjs';
import { mb, healthBadge, managerSummary, managerLaunchbar, launchSettingsFields } from './manager-views.mjs';
import { sampleState } from './demo.mjs';

const root = document.querySelector('#app'), modal = document.querySelector('#modal');
const bridge = window.orbit;
let state, demo = false, page = 'Accounts', group = '', query = '', statusFilter = '', machineFilter = '', pageNumber = 1, activeId = null, selected = new Set(), details = false, refreshBusy = false, frameBusy = false, queueDrawer = false;
const pageSize = 9, cachedFrames = new Map();
let theatre = null, streamWanted = false, frameError = '', frameLatency = 0, mouseBusy = false, lastMouse = 0, modalClose = null, nextFrameAt = 0;
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labels = { running: 'Running', idle: 'Idle', queued: 'Queued', launching: 'Launching', 'awaiting-window': 'Attach window', verification: 'Needs verification', disconnected: 'Disconnected', expired: 'Sign in again', error: 'Error', unknown: 'Unknown' };
const attentionStates = ['verification', 'disconnected', 'expired', 'error', 'unknown'];
const statusBadge = s => `<span class="badge ${e(s)}"><span class="dot"></span>${e(labels[s] || s)}</span>`;
const account = id => state.accounts.find(a => a.id === id);
const machine = id => state.machines.find(m => m.id === id);
const duration = at => { if (!at) return '—'; const mins = Math.max(0, Math.floor((Date.now() - at) / 60000)); return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`; };
const time = at => at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const date = at => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const safeAvatar = url => { try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)rbxcdn\.com$/.test(u.hostname) ? e(url) : ''; } catch { return ''; } };
function avatar(a, large = false) { const src = safeAvatar(a.avatar); return `<span class="avatar ${large ? 'large' : ''}">${src ? `<img src="${src}" alt="" loading="lazy">` : `<svg viewBox="0 0 40 40" aria-hidden="true"><path fill="currentColor" opacity=".65" d="M10 34v-7l10-4 10 4v7Z"/><rect x="10" y="7" width="20" height="18" rx="6" fill="currentColor"/><path d="M16 15h1m6 0h1m-7 5h6" stroke="#293a33" stroke-width="2" stroke-linecap="round"/></svg>`}</span>`; }
function meter(label, value) { const v = Math.max(0, Math.min(100, Number(value) || 0)); return `<div class="meter-row"><span>${label}</span><progress max="100" value="${v}" class="${v > 85 ? 'amber' : ''}" aria-label="${label} usage"></progress><span>${v}%</span></div>`; }
const btn = (action, label, ico = '', cls = '', data = '') => `<button data-action="${action}" class="${cls}" ${data}>${ico ? icon(ico) : ''}${label ? `<span>${label}</span>` : ''}</button>`;
const game = a => a.game || state.profiles.find(p => p.id === a.profileId)?.name || 'No game assigned';
function toast(message, error = false) { const container = document.querySelector('#toasts'); if ([...container.children].some(el => el.textContent === message)) return; while (container.children.length >= 3) container.firstElementChild.remove(); const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message; document.querySelector('#toasts').append(el); setTimeout(() => el.remove(), 6000); }
async function call(name, arg = {}) {
  if (!demo) { if (!bridge) throw new Error('Open the Orbit desktop app to connect accounts and machines.'); return bridge.call(name, arg); }
  if (name === 'state') return state;
  if (name === 'groups.configure') { state.groupSettings ||= {}; state.groupSettings[arg.name] = arg.config; return; }
  if (name === 'groups.rename') { state.groups = state.groups.map(g => g === arg.name ? arg.next : g); state.accounts.forEach(a => { if (a.group === arg.name) a.group = arg.next; }); state.groupSettings ||= {}; state.groupSettings[arg.next] = state.groupSettings[arg.name]; delete state.groupSettings[arg.name]; return; }
  if (name === 'servers.save') { state.privateServers ||= []; const server = { id: arg.id || `server-${Date.now()}`, name: arg.name, placeId: arg.placeId }; state.privateServers = state.privateServers.filter(s => s.id !== server.id); state.privateServers.push(server); return server; }
  if (name === 'servers.remove') { state.privateServers = (state.privateServers || []).filter(s => s.id !== arg.id); return; }
  if (name === 'accounts.health') { let alive = 0, dead = 0; for (const a of state.accounts.filter(a => arg.ids.includes(a.id))) { a.health = a.status === 'verification' ? 'dead' : 'alive'; a.checkedAt = Date.now(); a.health === 'dead' ? dead++ : alive++; } return { alive, dead, unknown: 0, skipped: 0 }; }
  if (name === 'games.lookup') return { name: 'Sample game', creator: 'Sample creator', playing: 1234 };
  if (name === 'accounts.relaunch') { account(arg.id).status = 'queued'; return; }
  if (name === 'updates.configure') { state.updates = { ...state.updates, automatic: arg.autoUpdate, channel: arg.updateChannel }; return; }
  if (name === 'workflows.save') { state.workflows ||= []; state.workflows.push({ ...arg, id: `demo-workflow-${Date.now()}` }); return; }
  if (name === 'workflows.remove') { state.workflows = (state.workflows || []).filter(w => w.id !== arg.id); return; }
  if (name.startsWith('window.')) return;
  if (name === 'accounts.launch') { for (const a of state.accounts.filter(a => arg.ids.includes(a.id))) { if (!attentionStates.includes(a.status)) a.status = 'queued'; } state.queue.pending = arg.ids; toast('Demo: accounts added to the sample launch queue.'); return; }
  if (name === 'accounts.stop' || name === 'accounts.stopAll') { for (const a of state.accounts.filter(a => name.endsWith('All') || arg.ids.includes(a.id))) a.status = 'idle'; state.queue.pending = []; return; }
  if (name === 'queue.pause') { state.queue.paused = true; state.queue.reason = 'Paused by you'; return; }
  if (name === 'queue.resume') { state.queue.paused = false; state.queue.reason = ''; return; }
  if (name === 'groups.add') { if (!arg.name || state.groups.includes(arg.name)) throw new Error('Choose a unique group name.'); state.groups.push(arg.name); return; }
  if (name === 'groups.remove') { if (state.accounts.some(a => a.group === arg.name)) throw new Error('Move accounts out of this group first.'); state.groups = state.groups.filter(g => g !== arg.name); return; }
  if (name === 'settings.save') { Object.assign(state.settings, arg); return; }
  if (name === 'profiles.save') { const p = { ...arg, id: arg.id || `demo-profile-${Date.now()}` }; const i = state.profiles.findIndex(x => x.id === p.id); if (i >= 0) state.profiles[i] = p; else state.profiles.push(p); return p; }
  if (name === 'accounts.update') { Object.assign(account(arg.id), arg); return; }
  if (name === 'accounts.organize') { for (const id of arg.ids) { account(id).group = arg.group; if (arg.profileId) account(id).profileId = arg.profileId; } return; }
  if (name === 'accounts.remove') { state.accounts = state.accounts.filter(a => a.id !== arg.id); selected.delete(arg.id); return; }
  if (name === 'schedules.add') { state.schedules.push({ ...arg, id: `demo-schedule-${Date.now()}`, status: 'pending' }); return; }
  if (name === 'schedules.remove') { state.schedules = state.schedules.filter(s => s.id !== arg.id); return; }
  if (name === 'control.release') return;
  throw new Error('Exit the demo workspace to use this feature with real accounts.');
}
async function refresh(force = false) {
  if (refreshBusy || !bridge && !demo || document.hidden && !force) return;
  refreshBusy = true;
  try { if (!demo) state = await call('state'); if (theatre?.localPlaying && !theatre.busy && state.localPlayId !== theatre.id) { theatre.localPlaying = false; const button = modal.querySelector('#control-button'); if (button) { button.innerHTML = icon('mouse') + '<span>Play here</span>'; button.classList.remove('danger'); } toast('Local play ended.'); } if (state && (force || !modal.open && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName))) render(); }
  catch (err) { toast(err.message, true); } finally { refreshBusy = false; }
}
function filtered() { const q = query.toLowerCase(); return state.accounts.filter(a => (!group || a.group === group) && (!q || [a.username, a.displayName, a.alias, a.notes, game(a)].some(v => v?.toLowerCase().includes(q))) && (!statusFilter || (statusFilter === 'attention' ? attentionStates.includes(a.status) : a.status === statusFilter)) && (!machineFilter || a.machineId === machineFilter)); }
function sidebar() {
  const navs = [['Accounts', 'accounts'], ['Live view', 'monitor'], ['Machines', 'machines'], ['Schedules', 'calendar'], ['Workflows', 'clock'], ['Account & License', 'shield'], ['Updates', 'refresh'], ['Activity', 'activity'], ['Settings', 'settings']];
  return `<aside class="sidebar"><div class="brand">${logo}<span>Orbit</span></div><nav class="nav" aria-label="Main navigation">${navs.map(([n, i]) => btn('nav', n, i, page === n ? 'active' : '', `data-page="${n}"`)).join('')}</nav><button data-action="commands" class="command-trigger">${icon('search')}<span>Quick actions</span><kbd>Ctrl K</kbd></button><div class="groups"><div class="row between groups-title"><span>Groups</span>${btn('group.add', '', 'plus', 'iconbutton', 'aria-label="Add group"')}</div><button class="groupbutton ${!group && page === 'Accounts' ? 'active' : ''}" data-action="group" data-group="">${icon('accounts')}<span>All accounts</span><span class="count">${state.accounts.length}</span></button>${state.groups.map(g => `<button class="groupbutton ${group === g && page === 'Accounts' ? 'active' : ''}" data-action="group" data-group="${e(g)}">${icon('folder')}<span>${e(g)}</span><span class="count">${state.accounts.filter(a => a.group === g).length}</span></button>`).join('')}</div><div class="sidebar-bottom"><div class="sidebar-status"><span class="dot ${state.machines.some(m => m.online) ? 'green' : ''}"></span>${demo ? 'Sample machines' : `${state.machines.filter(m => m.online).length} machine${state.machines.filter(m => m.online).length === 1 ? '' : 's'} connected`}</div>${btn('stop.all', 'Stop all', 'stop', '')}<div class="profile"><span class="avatar">${icon('shield')}</span><div><strong>${demo ? 'Demo workspace' : 'Local workspace'}</strong><p>${demo ? 'Sample accounts only' : 'Private on your machines'}</p></div></div></div></aside>`;
}
function titlebar() { return `<div class="titlebar"><span>${demo ? '<span class="demo-label">Demo workspace · sample data <button data-action="demo.exit">Exit demo</button></span>' : 'ORBIT / ACCOUNT WORKSPACE'}</span>${bridge ? `<div class="titlebar-controls">${btn('window.minimize', '', 'minus', '', 'aria-label="Minimize"')}${btn('window.maximize', '', 'expand', '', 'aria-label="Maximize"')}${btn('window.close', '', 'close', '', 'aria-label="Close Orbit"')}</div>` : '<span class="tiny">Design preview</span>'}</div>`; }
function header(title, subtitle, action = '', button = '', ico = 'plus') { return `<header class="pagehead"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${action ? btn(action, button, ico, 'primary') : ''}</header>`; }
function accountToolbar() { return `<div class="toolbar"><div class="searchbox">${icon('search')}<input id="search" placeholder="Search accounts…" value="${e(query)}" aria-label="Search accounts"><span class="kbd">Search</span></div><select id="status-filter" aria-label="Filter by status"><option value="">All statuses</option>${[['running','Running'],['idle','Idle'],['attention','Needs attention'],['queued','Queued'],['awaiting-window','Awaiting window']].map(([v, n]) => `<option value="${v}" ${v === statusFilter ? 'selected' : ''}>${n}</option>`).join('')}</select><select id="machine-filter" aria-label="Filter by machine"><option value="">All machines</option>${state.machines.map(m => `<option value="${e(m.id)}" ${m.id === machineFilter ? 'selected' : ''}>${e(m.name)}</option>`).join('')}</select>${btn('details.toggle', '', 'list', 'iconbutton', 'aria-label="Toggle account details" title="Toggle account details"')}</div>`; }
function accountsPage() {
  let out = header(group || 'Accounts', 'Launch, monitor, and organize your sessions.', 'account.add', 'Add accounts');
  if (!state.accounts.length) return out + onboarding();
  const rows = filtered(); pageNumber = Math.min(pageNumber, Math.max(1, Math.ceil(rows.length / pageSize))); const visible = rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  out += managerSummary(state) + managerLaunchbar(state, group, btn) + accountToolbar();
  const sections = [...new Set(visible.map(a => a.group || 'Ungrouped'))];
  out += `<div class="tablewrap"><table class="accounttable"><thead><tr><th><input id="select-page" type="checkbox" aria-label="Select visible accounts" ${visible.length && visible.every(a => selected.has(a.id)) ? 'checked' : ''}></th><th>Account</th><th>Connection</th><th class="healthcol">Health</th><th class="usagecol">Memory / CPU</th><th class="servercol">Private server</th><th class="uptime">Last launch</th><th></th></tr></thead><tbody>${sections.map(g => `<tr class="group-heading"><td colspan="8"><span>${e(g)}</span><small>${rows.filter(a => (a.group || 'Ungrouped') === g).length} accounts</small></td></tr>${visible.filter(a => (a.group || 'Ungrouped') === g).map(a => `<tr class="account-row ${activeId === a.id ? 'selected' : ''}" data-account="${e(a.id)}" tabindex="0" aria-label="${e(a.username)}, ${e(labels[a.status])}"><td><input type="checkbox" data-select="${e(a.id)}" aria-label="Select ${e(a.username)}" ${selected.has(a.id) ? 'checked' : ''}></td><td><div class="accountcell">${avatar(a)}<div><strong>${e(a.alias || a.displayName)}</strong><p>@${e(a.username)} <span class="muted">· ${e(machine(a.machineId)?.name || 'This PC')}</span></p><select data-inline="group" data-id="${e(a.id)}" aria-label="Group for ${e(a.username)}" ${a.peerId ? 'disabled' : ''}>${state.groups.map(g => `<option ${g === a.group ? 'selected' : ''}>${e(g)}</option>`).join('')}</select></div></div></td><td>${a.relaunchAt ? `<span class="badge queued" data-countdown="${a.relaunchAt}">Relaunching in ${Math.max(0, Math.ceil((a.relaunchAt - Date.now()) / 1000))}s</span>` : statusBadge(a.status)}</td><td class="healthcol">${healthBadge(a)}</td><td class="usagecol"><strong>${mb(a.metrics?.memoryBytes)}</strong><p>${a.metrics ? `${a.metrics.cpu.toFixed(1)}% · PID ${a.metrics.pid}` : 'No process'}</p></td><td class="servercol"><select data-inline="serverId" data-id="${e(a.id)}" aria-label="Private server for ${e(a.username)}" ${a.peerId ? 'disabled' : ''}><option value="">Unassigned</option>${(state.privateServers || []).map(s => `<option value="${e(s.id)}" ${s.id === a.serverId ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select></td><td class="uptime"><span title="${a.lastLaunchedAt ? e(new Date(a.lastLaunchedAt).toLocaleString()) : ''}">${time(a.lastLaunchedAt)}</span></td><td><div class="row row-actions">${btn('account.relaunch', '', 'refresh', 'iconbutton', `data-id="${e(a.id)}" aria-label="Relaunch ${e(a.username)}" ${a.peerId ? 'disabled' : ''}`)}${btn('account.menu', '', 'more', 'iconbutton', `data-id="${e(a.id)}" aria-label="Actions for ${e(a.username)}"`)}</div></td></tr>`).join('')}`).join('')}</tbody></table>${!rows.length ? '<div class="empty"><h3>No matching accounts</h3><p>Try another search or clear your filters.</p><button data-action="filters.clear" class="small">Clear filters</button></div>' : ''}</div>`;
  out += `<div class="tablefoot"><span>${rows.length ? `Showing ${(pageNumber - 1) * pageSize + 1}–${Math.min(pageNumber * pageSize, rows.length)} of ${rows.length} accounts` : '0 accounts'}</span><div class="pagination">${btn('page.prev', '‹', '', '', `aria-label="Previous page" ${pageNumber === 1 ? 'disabled' : ''}`)}<button class="active" aria-current="page">${pageNumber}</button><span>/ ${Math.max(1, Math.ceil(rows.length / pageSize))}</span>${btn('page.next', '›', '', '', `aria-label="Next page" ${pageNumber * pageSize >= rows.length ? 'disabled' : ''}`)}</div></div>`;
  return out + selectionBar() + `<p class="table-note">Connection tracks the game window. Health checks test the saved login session.</p>`;
}
function selectionBar() { return selected.size ? `<div class="selectionbar"><span class="selectioncount">${selected.size} selected</span>${btn('bulk.launch', 'Launch', 'play', 'primary')}${btn('health.check', 'Check health', 'shield', 'ghost')}${btn('bulk.stop', 'Stop', 'stop', 'ghost danger')}${btn('bulk.organize', '', 'folder', 'iconbutton', 'aria-label="Organize selected accounts" title="Change group and launch profile"')}${btn('selection.clear', '', 'close', 'iconbutton', 'aria-label="Clear selection"')}</div>` : '<div class="selection-placeholder">Select accounts to manage them together</div>'; }
function onboarding() { return `<section class="onboarding">${logo}<h1>A calmer space for<br>all your accounts.</h1><p>Connect your accounts, organize your machines, and open any game session from one workspace.</p><div class="featurelist"><div class="row">${icon('shield')}<div><strong>Sign in directly with Roblox</strong><p>Login sessions stay encrypted on this machine.</p></div></div><div class="row">${icon('monitor')}<div><strong>Your sessions, one click away</strong><p>Attach a game window for live previews and remote play.</p></div></div><div class="row">${icon('clock')}<div><strong>Launch at a controlled pace</strong><p>One queue, with pauses for verification and rate limits.</p></div></div></div>${!demo && state.platform !== 'win32' ? '<div class="os-warning">Connect and control Roblox from the Windows desktop app.</div>' : ''}<div class="row">${btn('account.add', 'Connect your first account', 'plus', 'primary')}${btn('demo.enter', 'Explore demo', 'arrow', 'ghost')}</div><span class="onboarding-footer">No passwords or session cookies are shown in the dashboard.</span></section>`; }
function frameMarkup(a, theatreView = false) {
  const frame = cachedFrames.get(a.id), image = demo ? 'assets/sample-scene.svg' : frame?.data;
  return `<div class="preview ${theatreView && theatre?.controlling ? 'controlling' : ''}" ${theatreView ? 'id="remote-surface" tabindex="0"' : ''}>${image ? `<img src="${image}" alt="${demo ? 'Illustrated sample game scene' : `Live window preview for ${e(a.username)}`}" draggable="false"><span class="preview-badge"><span class="dot green"></span>${demo ? 'Sample preview · not live' : `LIVE PREVIEW · ${state.settings.previewFps} FPS`}</span>` : `<div class="preview-placeholder">${icon(a.windowAttached ? 'monitor' : 'link')}<h3>${a.windowAttached ? 'Ready to watch' : 'No window attached'}</h3><p>${a.windowAttached ? 'Start a live preview of this account’s Roblox window.' : 'Launch the account, then attach its Roblox window.'}</p>${a.windowAttached ? btn('preview.start', 'Watch session', 'play', 'small', `data-id="${e(a.id)}"`) : !a.peerId ? btn('window.attach', 'Attach window', 'link', 'small', `data-id="${e(a.id)}"`) : '<span class="tiny muted">Attach the window on the host PC.</span>'}</div>`}</div>`;
}
function detailPanel() {
  const a = account(activeId); if (!a) return '';
  const m = machine(a.machineId), needs = state.accounts.filter(a => attentionStates.includes(a.status)).length;
  return `<aside class="detail" aria-label="Account details"><div class="detailhead">${avatar(a, true)}<div class="grow"><div class="row wrap"><h2>${e(a.alias || a.displayName)}</h2></div><p>@${e(a.username)}</p><div class="detail-status">${statusBadge(a.status)}</div></div>${btn('details.toggle', '', 'close', 'iconbutton', 'aria-label="Close details"')}</div><div class="detail-meta"><div class="row">${icon('monitor')}<div><strong>${e(m?.name || 'This PC')}</strong><p>Assigned machine</p></div></div><div class="row"><span class="game-icon">${icon('cube')}</span><div><strong>${e(game(a))}</strong><p>Launch profile</p></div></div></div><div id="detail-frame">${frameMarkup(a)}</div><div class="preview-actions">${btn('remote.open', 'Remote Play', 'play', 'primary', `data-id="${e(a.id)}" ${!a.windowAttached && !demo ? 'disabled' : ''}`)}${btn('watch.open', 'Fullscreen', 'expand', '', `data-id="${e(a.id)}" ${!a.windowAttached && !demo ? 'disabled' : ''}`)}${btn('screenshot', 'Screenshot', 'camera', '', `data-id="${e(a.id)}" ${!a.windowAttached && !demo ? 'disabled' : ''}`)}</div><div class="session-controls"><span>${icon('monitor')}${demo ? 'Sample preview' : 'Window preview'}</span><span>${icon('mouse')}Control released</span></div>${frameError ? `<div class="detail-error">${e(frameError)}</div>` : ''}${a.error ? `<div class="detail-error">${e(a.error)}</div>` : ''}${attentionStates.includes(a.status) && !a.peerId ? `<div class="row detail-reconnect">${btn('account.verify', 'Open Roblox sign-in', 'shield', 'small', `data-id="${e(a.id)}"`)}</div>` : ''}<section class="detailsection"><h3>Machine performance ${m ? `(${e(m.name)})` : ''}</h3>${meter('CPU', m?.cpu)}${meter('RAM', m?.ram)}</section><section class="detailsection"><h3>Account health & process</h3><div class="row between">${healthBadge(a)}<span class="tiny muted">${a.checkedAt ? time(a.checkedAt) : 'Never checked'}</span></div><p class="help">${a.metrics ? `${mb(a.metrics.memoryBytes)} · ${a.metrics.cpu}% CPU · PID ${a.metrics.pid}` : 'No tracked process'}</p><p class="help">${a.autoRelaunch === false ? 'Excluded from automatic relaunch' : 'Included when group auto-relaunch is on'}</p></section><section class="detailsection"><h3>Session info</h3><div class="session-grid"><div><small>Session started</small><strong>${time(a.startedAt)} ${a.startedAt ? `(${duration(a.startedAt)})` : ''}</strong></div><div><small>Last seen</small><strong>${a.lastSeen ? time(a.lastSeen) : '—'}</strong></div><div><small>Added to Orbit</small><strong>${date(a.addedAt)}</strong></div><div><small>Roblox user ID</small><strong>${a.userId}</strong></div></div></section><section class="detailsection"><div class="row between"><h3>Account settings</h3>${!a.peerId ? btn('account.edit', 'Edit', '', 'small ghost', `data-id="${e(a.id)}"`) : ''}</div><p class="detailnotes">${a.notes ? e(a.notes) : `Group: ${e(a.group)} · ${a.peerId ? 'Managed on the host machine' : 'Stored on this machine'}`}</p></section>${needs ? `<div class="attention">${icon('warning')}<span>${needs} account${needs === 1 ? '' : 's'} need attention</span>${btn('attention', 'Review →')}</div>` : ''}</aside>`;
}
function livePage() {
  const accounts = filtered().filter(a => a.windowAttached || demo && a.status === 'running').slice(0, 9);
  return header('Live view', 'Window previews on demand. Open a session to watch or take control.', 'preview.all', streamWanted ? 'Pause previews' : 'Start previews', streamWanted ? 'pause' : 'play') + accountToolbar() + (accounts.length ? `<div class="notice">${icon('monitor')}Only visible previews update. Remote play uses the actual Roblox window on its host.</div><div class="previewgrid">${accounts.map(a => `<article class="card previewcard"><div class="cardtop">${avatar(a)}<div><strong>${e(a.username)}</strong><p>${e(machine(a.machineId)?.name || 'This PC')}</p></div>${statusBadge(a.status)}</div><div data-grid-frame="${e(a.id)}">${frameMarkup(a)}</div><div class="cardfooter"><span>${e(game(a))}</span>${btn('remote.open', 'Remote Play', 'play', 'small', `data-id="${e(a.id)}"`)}</div></article>`).join('')}</div>` : `<div class="empty"><div class="empty-symbol">${icon('monitor')}</div><h2>Your sessions will appear here</h2><p>Launch an account and attach its Roblox window to start watching.</p>${btn('nav', 'Go to accounts', 'arrow', 'primary', 'data-page="Accounts"')}</div>`);
}
function machinesPage() { return header('Machines', 'Keep an eye on the computers behind your sessions.', 'machine.pair', 'Pair machine', 'link') + `<div class="notice">${icon('shield')}Connections use HTTPS, a pinned certificate, and a private pairing token. Enable hosting on the other PC first.</div><div class="cards">${state.machines.map(m => `<article class="card"><div class="row cardtop">${icon('machines')}<div class="grow"><strong>${e(m.name)}</strong><p>${m.id === 'local' ? 'This computer' : e(m.address || 'Sample machine')}</p></div><span class="badge ${m.online ? 'running' : 'unknown'}"><span class="dot"></span>${m.online ? 'Online' : 'Offline'}</span></div>${meter('CPU', m.cpu)}${meter('RAM', m.ram)}<div class="row between cardfooter"><span>${m.running || 0} running · ${m.accounts} accounts</span>${m.id === 'local' ? btn('host.settings', 'Host settings', 'settings', 'small ghost') : btn('machine.remove', 'Unpair', 'exit', 'small ghost', `data-id="${e(m.id)}"`)}</div>${m.error ? `<div class="detail-error">${e(m.error)}</div>` : ''}</article>`).join('')}</div><section class="card host-summary"><div class="row between"><div><h2>Share this machine</h2><p>${state.host.enabled ? `Listening on ${e(state.host.address)}` : 'Hosting is off. Turn it on to access this computer from another Orbit installation.'}</p></div>${btn(state.host.enabled ? 'host.pairing' : 'host.settings', state.host.enabled ? 'Pairing details' : 'Configure host', state.host.enabled ? 'link' : 'settings', 'small')}</div>${state.host.error ? `<p class="error-message">${e(state.host.error)}</p>` : ''}</section>`; }
function schedulesPage() { return header('Schedules', 'Plan launches and stops in your local time. Repeat them with Plus or Pro.', 'schedule.add', 'New schedule', 'calendar') + `<div class="notice">${icon('clock')}Orbit must stay open on this PC. Schedules missed by more than 5 minutes are marked as missed.</div>${state.schedules.length ? `<div class="cards">${state.schedules.map(s => `<article class="card"><div class="row between"><strong>${e(s.name)}</strong><span class="badge ${s.status === 'failed' ? 'error' : s.status === 'done' ? 'running' : ''}">${e(s.status)}</span></div><div class="schedule-time">${time(s.at)}</div><div class="schedule-date">${date(s.at)} · ${e(s.recurrence || 'once')}</div><div class="row between cardfooter"><span>${s.action === 'launch' ? 'Launch' : 'Stop'} ${s.accountIds.length} account${s.accountIds.length === 1 ? '' : 's'}</span>${btn('schedule.remove', '', 'trash', 'iconbutton danger', `data-id="${e(s.id)}" aria-label="Delete ${e(s.name)}"`)}</div>${s.error ? `<p class="error-message">${e(s.error)}</p>` : ''}</article>`).join('')}</div>` : `<div class="empty"><div class="empty-symbol">${icon('calendar')}</div><h2>A little less manual work</h2><p>Schedule a group of accounts to launch or stop at a specific time.</p>${btn('schedule.add', 'Create schedule', 'plus', 'primary')}</div>`}`; }
function activityPage() { return header('Activity', 'A clear history of account connections, launches, and issues.', 'activity.export', 'Export history', 'download') + `<div class="activitylist">${state.activity.length ? state.activity.map(a => `<article class="activityitem ${e(a.level)}">${icon(a.level === 'warning' ? 'warning' : 'activity')}<div><p>${e(a.message)}</p><small>${date(a.at)} · ${time(a.at)}</small></div></article>`).join('') : '<div class="empty"><h2>Nothing to report yet</h2><p>Connect an account to start your workspace history.</p></div>'}</div>`; }
function settingsPage() {
  const s = state.settings;
  return header('Settings', 'Make this workspace work the way you do.') + `<div class="settings-layout"><form id="settings-form" class="settings-form"><section class="card"><h2>Launch queue</h2><p>Launch pacing is a resource limit, not a guarantee against Roblox verification.</p><div class="formgrid"><label>Delay between launches (seconds)<input name="launchDelay" type="number" min="0" max="120" required value="${s.launchDelayMs / 1000}"></label><label>Concurrent launch requests<select name="maxConcurrent">${[1,2,3,4,5].map(n => `<option ${n === s.maxConcurrent ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div></section><section class="card"><h2>Multiple sessions</h2><label class="checklabel"><input type="checkbox" name="multiSession" ${s.multiSession !== false ? 'checked' : ''}>Keep multiple Roblox accounts open on this PC</label><p>Close all Roblox windows before enabling. Keep Orbit open, then launch your accounts here. Each account gets its own game window.</p></section><section class="card"><h2>Launcher</h2><p>Use your registered Roblox protocol handler, or select an installed Froststrap launcher.</p><label>Custom launcher executable<input id="launcher-path" name="launcherPath" placeholder="Default Roblox protocol handler" value="${e(s.launcherPath)}" readonly></label><div class="row">${btn('launcher.pick', 'Choose .exe', 'folder', 'small', 'type="button"')}${btn('launcher.clear', 'Use default', '', 'small ghost', 'type="button"')}</div></section><section class="card"><h2>Launch profiles</h2><p>Set a game’s numeric place ID, then assign this profile to your accounts.</p>${state.profiles.map(p => `<div class="profile-row"><span class="game-icon">${icon('cube')}</span><div><strong>${e(p.name)}</strong><p>${p.placeId ? `Place ${e(p.placeId)}${p.jobId ? ' · Specific server' : ''}` : 'No place ID set'}</p></div>${btn('profile.edit', 'Edit', '', 'small ghost', `type="button" data-id="${e(p.id)}"`)}</div>`).join('')}<div class="row">${btn('profile.add', 'Add profile', 'plus', 'small', 'type="button"')}</div></section><section class="card"><h2>Machine hosting</h2><p>Let a paired Orbit installation view and manage this computer. Remote input uses the host’s foreground Roblox window.</p><div class="stack"><label class="checklabel"><input type="checkbox" name="hostEnabled" ${s.hostEnabled ? 'checked' : ''}>Enable HTTPS host</label><div class="formgrid"><label>Listen on<select name="hostBind"><option value="127.0.0.1" ${s.hostBind === '127.0.0.1' ? 'selected' : ''}>This PC only</option><option value="0.0.0.0" ${s.hostBind === '0.0.0.0' ? 'selected' : ''}>Local network / VPN</option></select></label><label>Port<input name="hostPort" type="number" min="1024" max="65535" value="${s.hostPort}" required></label></div><label class="checklabel"><input type="checkbox" name="allowRemoteControl" ${s.allowRemoteControl ? 'checked' : ''}>Allow paired machines to send keyboard and mouse input</label><label>Preview rate<select name="previewFps">${[1,3,5,10].map(n => `<option value="${n}" ${n === s.previewFps ? 'selected' : ''}>${n} frames per second</option>`).join('')}</select></label></div>${state.host.enabled ? `<div class="row">${btn('host.pairing', 'Show pairing details', 'link', 'small', 'type="button"')}${btn('host.rotate', 'Rotate token', 'refresh', 'small ghost', 'type="button"')}</div>` : ''}</section><section class="card"><h2>Session alerts · Plus / Pro</h2><label class="checklabel"><input type="checkbox" name="desktopAlerts" ${s.desktopAlerts ? 'checked' : ''}>Show a desktop notification when a session needs attention</label></section><section class="card"><h2>Appearance</h2><div class="formgrid"><label>Workspace theme<select name="theme"><option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark · Graphite</option><option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light · Chalk</option></select></label></div></section><div class="row">${btn('settings.submit', 'Save settings', 'check', 'primary', 'type="submit"')}</div></form><aside class="settings-aside"><section class="card"><div class="row">${icon('shield')}<h3>Your account vault</h3></div><p>Roblox sessions and pairing tokens are encrypted using your operating system. Secrets never appear in account lists or activity logs.</p><span class="badge ${state.secureStorage ? 'running' : 'error'}"><span class="dot"></span>${demo ? 'Sample protection status' : state.secureStorage ? 'OS encryption available' : 'Encryption unavailable'}</span></section><section class="card"><h3>Encrypted backups</h3><p>Export accounts with a separate passphrase. Imports merge accounts and keep your existing workspace.</p><div class="stack">${btn('backup.export', 'Export backup', 'download', 'small')}${btn('backup.import', 'Import backup', 'upload', 'small')}</div></section><section class="card"><h3>About Orbit</h3><p>Version ${e(state.updates?.version || '0.4.0')}<br>An independent desktop workspace for your Roblox accounts.</p><div class="stack">${btn('link.open', 'Orbit on GitHub', 'arrow', 'small ghost', 'data-id="help"')}${btn('link.open', 'Froststrap', 'arrow', 'small ghost', 'data-id="froststrap"')}${btn('link.open', 'Account Manager reference', 'arrow', 'small ghost', 'data-id="reference"')}</div></section>${!demo ? `<section class="card"><h3>Explore the layout</h3><p>Try the interface with isolated sample data.</p>${btn('demo.enter', 'Open demo workspace', 'play', 'small')}</section>` : ''}</aside></div>`;
}
function render() {
  if (!state) return;
  const scroll = document.querySelector('.content')?.scrollTop || 0, tableScroll = document.querySelector('.tablewrap')?.scrollTop || 0;
  if (!activeId || !account(activeId)) activeId = state.accounts[demo ? 2 : 0]?.id || null;
  selected = new Set([...selected].filter(id => account(id)));
  document.body.classList.toggle('light', state.settings.theme === 'light');
  const pages = { Accounts: accountsPage, 'Live view': livePage, Machines: machinesPage, Schedules: schedulesPage, Activity: activityPage, Settings: settingsPage, 'Account & License': () => licensePage(state, demo), Updates: () => updatesPage(state, demo), Workflows: () => workflowsPage(state) };
  const queueCount = state.queue.pending.length + state.queue.active.length;
  root.innerHTML = `<div class="shell">${sidebar()}<main class="workspace">${titlebar()}<div class="workspace-body"><section class="content">${(pages[page] || accountsPage)()}</section>${page === 'Accounts' && details && state.accounts.length ? detailPanel() : ''}</div><footer class="statusbar"><span class="dot green"></span><span>${demo ? 'Sample workspace — actions are simulated' : 'Local workspace'}</span><span>· ${state.accounts.length} accounts</span><span class="spacer"></span>${btn('queue.open', `${state.queue.paused ? 'Queue paused' : queueCount ? 'Launching' : 'Queue ready'}${queueCount ? ` · ${queueCount} waiting` : ''}`, state.queue.paused ? 'pause' : 'clock')}${!demo ? `<span class="muted">· Updated ${time(Date.now())}</span>` : ''}</footer></main></div>`;
  document.querySelector('.content').scrollTop = scroll; const tw = document.querySelector('.tablewrap'); if (tw) tw.scrollTop = tableScroll;
}

function showModal(title, body, footer, onSubmit = null, cls = '') {
  if (modal.open) { const cleanup = modalClose; modalClose = null; cleanup?.(); modal.close(); } modal.className = cls;
  modal.innerHTML = `<form id="modal-form"><div class="modalhead"><h2>${e(title)}</h2>${btn('modal.close', '', 'close', 'iconbutton', 'type="button" aria-label="Close dialog"')}</div><div class="modalbody">${body}<p class="error-message hidden" id="modal-error" role="alert"></p></div><div class="modalfoot">${footer || btn('modal.close', 'Close', '', '', 'type="button"')}</div></form>`;
  modal.showModal();
  if (onSubmit) modal.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); const submit = modal.querySelector('[type=submit]'); if (submit) submit.disabled = true;
    try { await onSubmit(new FormData(event.currentTarget)); await refresh(true); }
    catch (err) { const box = modal.querySelector('#modal-error'); if (box) { box.textContent = err.message; box.classList.remove('hidden'); } else toast(err.message, true); }
    finally { if (submit?.isConnected) submit.disabled = false; }
  });
}
const cancel = () => btn('modal.close', 'Cancel', '', '', 'type="button"');
const submit = (label = 'Save') => `<button type="submit" class="primary">${e(label)}</button>`;
function confirm(title, message, run, label = 'Confirm') { showModal(title, `<p>${e(message)}</p>`, cancel() + submit(label), async () => { await run(); modal.close(); }); }
function groupModal() { showModal('Create a group', '<p>Keep related accounts together and launch them as a group.</p><label>Group name<input name="name" required maxlength="80" placeholder="e.g. Main accounts" autofocus></label>', cancel() + submit('Create group'), async fd => { await call('groups.add', { name: fd.get('name').trim() }); modal.close(); toast('Group created.'); }); }
function profileModal(id) {
  const p = state.profiles.find(p => p.id === id); let timer, generation = 0;
  showModal(p ? 'Edit launch profile' : 'New launch profile', `<label>Profile name<input name="name" required maxlength="80" value="${e(p?.name)}" placeholder="e.g. Blox Fruits"></label><label>Place ID<input name="placeId" inputmode="numeric" pattern="[1-9][0-9]{0,19}" required maxlength="20" value="${e(p?.placeId)}" placeholder="Numeric ID from the Roblox game URL"></label><div class="row"><button type="button" id="validate-game" class="small">Validate game</button><span id="game-result" class="help" role="status"></span></div><label>Server job ID <span class="tiny">Optional · leave blank for a public server</span><input name="jobId" maxlength="64" value="${e(p?.jobId)}" placeholder="Optional server instance ID"></label>`, cancel() + submit(), async fd => { await call('profiles.save', { ...(p ? { id: p.id } : {}), name: fd.get('name'), placeId: fd.get('placeId'), jobId: fd.get('jobId') }); modal.close(); toast('Launch profile saved.'); });
  const input = modal.querySelector('[name=placeId]'), box = modal.querySelector('#game-result'), button = modal.querySelector('#validate-game');
  const lookup = async () => {
    clearTimeout(timer); const current = ++generation, placeId = input.value.trim(); if (!/^[1-9]\d{0,19}$/.test(placeId)) return;
    button.disabled = true; box.textContent = 'Looking up game…'; box.className = 'help';
    try { const game = await call('games.lookup', { placeId }); if (current !== generation || !box.isConnected) return; box.textContent = `${game.name} · ${game.creator} · ${game.playing.toLocaleString()} playing`; box.className = 'health alive'; }
    catch (err) { if (current === generation && box.isConnected) { box.textContent = err.message; box.className = 'error-message'; } }
    finally { if (current === generation) button.disabled = false; }
  };
  input.addEventListener('input', () => { generation++; button.disabled = false; clearTimeout(timer); box.textContent = ''; if (/^[1-9]\d{0,19}$/.test(input.value.trim())) timer = setTimeout(lookup, 800); });
  button.addEventListener('click', lookup); if (p?.placeId) timer = setTimeout(lookup, 100);
  modalClose = () => { generation++; clearTimeout(timer); };
}

function addAccounts() {
  showModal('Add accounts', `<p>Choose how to connect your Roblox accounts. Sessions stay in your encrypted local vault.</p><button type="button" data-action="signin.browser" class="add-method"><strong>Login from browser</strong><span>Use a fresh Edge or Chrome window. Imports automatically.</span></button><button type="button" data-action="sessions.paste" class="add-method"><strong>Paste sessions / load files</strong><span>Bulk import your existing sessions from text, CSV, or log files.</span></button><button type="button" data-action="signin.builtin" class="add-method"><strong>Built-in sign-in</strong><span>Use Orbit’s isolated Roblox sign-in window.</span></button>`, cancel());
}
function importSessions() {
  showModal('Import sessions', `<label>Add to group<select name="group">${state.groups.map(g => `<option ${g === group ? 'selected' : ''}>${e(g)}</option>`).join('')}</select></label><label>Session tokens<textarea class="mono" name="sessions" maxlength="5000000" autocomplete="off" spellcheck="false" placeholder="One session token per line, or a CSV containing session tokens" required></textarea></label><div class="row">${btn('sessions.files', 'Load .txt / .csv / .log', 'folder', 'small', 'type="button"')}</div><p class="help">Review files here before importing. Existing accounts are updated by Roblox user ID. Tokens are cleared from this form when import starts.</p>`, cancel() + submit('Import accounts'), async fd => {
    const sessions = fd.get('sessions'); modal.querySelector('[name="sessions"]').value = '';
    const r = await call('sessions.import', { sessions, group: fd.get('group') }); modalClose = null;
    showModal('Import complete', `<div class="import-results"><div><strong>${r.imported}</strong><small>Added</small></div><div><strong>${r.updated}</strong><small>Updated</small></div><div><strong>${r.failed.length}</strong><small>Failed</small></div><div><strong>${r.skipped}</strong><small>Skipped</small></div></div>${r.failed.length ? `<div class="checklist">${r.failed.map(f => `<p class="import-failure">Line ${f.line}: ${e(f.reason)}</p>`).join('')}</div>` : '<p>All sessions were validated and saved.</p>'}`, btn('modal.close', 'Done', '', 'primary', 'type="button"'));
  });
  modalClose = () => { const field = modal.querySelector('[name="sessions"]'); if (field) field.value = ''; if (!demo && bridge) call('operation.cancel').catch(() => {}); };
}
async function startBrowserLogin() {
  if (demo || !bridge) return toast('Use the Windows desktop app outside demo to sign in.', true);
  const result = await call('browser.start', { group: group || state.groups[0] });
  showModal('Sign in in your browser', `<div class="notice">${icon('shield')}Orbit opened a disposable browser profile.</div><p>Complete Roblox sign-in normally. Orbit will import the account automatically and close that browser window.</p><p class="help">Your existing browser profiles and tabs stay separate.</p>`, cancel());
  const interval = setInterval(async () => { try { const result2 = await call('browser.status', { id: result.id }); if (result2.error) { const box = modal.querySelector('#modal-error'); if (box) { box.textContent = result2.error; box.classList.remove('hidden'); } } if (result2.closed) { clearInterval(interval); modalClose = null; modal.close(); if (result2.accountId) activeId = result2.accountId; await refresh(true); toast(result2.imported ? 'Account imported securely.' : 'Browser sign-in closed. No account was imported.'); } } catch {} }, 2000);
  modalClose = () => { clearInterval(interval); call('browser.cancel', { id: result.id }).catch(() => {}); };
}
async function launchSettings(name = group || state.groups[0]) {
  if (!name) return groupModal();
  showModal('Launch settings', launchSettingsFields(state, name), btn('modal.close', 'Close', '', '', 'type="button"') + submit('Save & close'), async () => { await save(); modalClose = null; modal.close(); });
  const form = modal.querySelector('form'); let timer, last = '', chain = Promise.resolve();
  const save = async () => {
    clearTimeout(timer); if (!form.checkValidity()) throw new Error('Check the launch delays and memory limit.');
    const fd = new FormData(form), config = { profileId: fd.get('profileId'), launchDelayMs: Number(fd.get('launchDelay')) * 1000, relaunchDelayMs: Number(fd.get('relaunchDelay')) * 1000, autoRelaunch: fd.has('autoRelaunch'), serverMode: fd.get('serverMode'), serverIds: fd.getAll('serverIds'), memoryWarningMb: Number(fd.get('memoryWarningMb')) };
    const key = JSON.stringify(config); if (key === last) return chain;
    last = key; chain = chain.catch(() => {}).then(() => call('groups.configure', { name, config })).catch(err => { last = ''; throw err; });
    await chain; state.groupSettings ||= {}; state.groupSettings[name] = config;
    const status = form.querySelector('#launch-save'); if (status) status.textContent = 'Saved';
  };
  form.addEventListener('input', () => { const status = form.querySelector('#launch-save'); if (status) status.textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(() => save().catch(err => toast(err.message, true)), 1800); });
  form.querySelector('#launch-group').addEventListener('change', async ev => { try { await save(); modalClose = null; await launchSettings(ev.target.value); } catch (err) { toast(err.message, true); } });
  modalClose = () => { clearTimeout(timer); save().catch(err => toast(err.message, true)); };
}
function serverModal(id) {
  const server = (state.privateServers || []).find(s => s.id === id);
  showModal(server ? 'Edit private server' : 'Add private server', `<label>Server name<input name="name" maxlength="80" value="${e(server?.name)}" required placeholder="e.g. Main private server"></label><label>Place ID<input name="placeId" maxlength="20" pattern="[1-9][0-9]{0,19}" value="${e(server?.placeId)}" required></label><label>Private link or access code<input name="target" type="password" autocomplete="new-password" maxlength="2048" required placeholder="Roblox invite URL or access code"></label><p class="help">Invites are encrypted and never shown in account lists. When editing, enter the invite again. If a share link cannot be resolved, use the full /games/ private-server link.</p>`, cancel() + submit('Save server'), async fd => { await call('servers.save', { ...Object.fromEntries(fd), ...(id ? { id } : {}) }); modal.close(); await refresh(true); await launchSettings(); });
}
function commandPalette() {
  if (theatre) return;
  const commands = [['Account Manager: Open','nav','Accounts'],['Account Manager: Add accounts','account.add'],['Account Manager: Launch settings','launch.settings'],['Account Manager: Check health','health.check'],['Account Manager: Performance overlay','monitor.overlay'],['Account Manager: Pop out','monitor.popout'],['Live view: Open','nav','Live view'],['Settings: Open','nav','Settings'],['Updates: Open','nav','Updates']];
  showModal('Quick actions', `<input id="command-search" aria-label="Search commands" placeholder="Type a command…" autofocus><div class="command-list">${commands.map(([label, action, page]) => `<button type="button" data-command="${action}" data-page="${e(page)}">${icon('arrow')}${e(label)}</button>`).join('')}</div>`, btn('modal.close', 'Close', '', '', 'type="button"'));
  modal.querySelector('#command-search').addEventListener('input', ev => { for (const button of modal.querySelectorAll('[data-command]')) button.hidden = !button.textContent.toLowerCase().includes(ev.target.value.toLowerCase()); });
  modal.querySelector('#command-search').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); modal.querySelector('[data-command]:not([hidden])')?.click(); } });
  for (const button of modal.querySelectorAll('[data-command]')) button.addEventListener('click', async () => { modal.close(); try { await handle(button.dataset.command, button.dataset, button); } catch (err) { toast(err.message, true); } });
}

function editAccount(id) { const a = account(id); if (!a || a.peerId) return toast('Edit this account on its host machine.', true); showModal(`Edit ${a.username}`, `<label>Alias<input name="alias" maxlength="80" value="${e(a.alias)}" placeholder="Optional nickname"></label><label class="checklabel"><input name="autoRelaunch" type="checkbox" ${a.autoRelaunch !== false ? 'checked' : ''}>Include in automatic relaunch</label><label>Assigned private server<select name="serverId"><option value="">Unassigned</option>${(state.privateServers || []).map(s => `<option value="${e(s.id)}" ${s.id === a.serverId ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select></label><label>Group<select name="group">${state.groups.map(g => `<option ${g === a.group ? 'selected' : ''}>${e(g)}</option>`).join('')}</select></label><label>Launch profile<select name="profileId">${state.profiles.map(p => `<option value="${e(p.id)}" ${p.id === a.profileId ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></label><label>Notes<textarea name="notes" maxlength="2000" placeholder="Useful details about this account">${e(a.notes)}</textarea></label>`, cancel() + submit(), async fd => { await call('accounts.update', { id, alias: fd.get('alias'), autoRelaunch: fd.has('autoRelaunch'), serverId: fd.get('serverId'), group: fd.get('group'), profileId: fd.get('profileId'), notes: fd.get('notes') }); modal.close(); toast('Account updated.'); }); }
async function signIn(id) {
  if (demo || !bridge) return toast('Open the Windows desktop app and exit demo to sign in.', true);
  const a = account(id);
  showModal(a ? `Reconnect ${a.username}` : 'Connect a Roblox account', `<div class="notice">${icon('shield')}Sign in through Roblox’s own window. Orbit stores the resulting session in your local encrypted vault.</div>${!a ? `<label>Add to group<select name="group">${state.groups.map(g => `<option ${g === (group || state.groups[0]) ? 'selected' : ''}>${e(g)}</option>`).join('')}</select></label>` : '<p>Complete any verification Roblox shows, then return here.</p>'}`, cancel() + submit('Open Roblox sign-in'), async fd => {
    const result = await call('login.start', { existingId: id, group: fd.get('group') || 'Main' });
    showModal('Finish connecting your account', `<div class="notice">${icon('lock')}The Roblox sign-in window is open.</div><p>Finish signing in there, including any verification. Then return to Orbit and choose <strong>Finish sign-in</strong>.</p><p>For an account lock, complete the unlock flow on Roblox before continuing.</p>`, cancel() + submit('Finish sign-in'), async () => {
      const result2 = await call('login.finish', { id: result.id }); modalClose = null; modal.close(); activeId = result2.id; toast('Account connected securely.');
    });
    modalClose = () => call('login.cancel', { id: result.id }).catch(() => {});
  });
}
async function attachWindow(id) {
  if (demo) return toast('Demo previews use an illustration. Real window attachment is available in the desktop app.');
  const list = await call('windows.list');
  showModal('Attach a Roblox window', `<p>Select the Roblox window belonging to <strong>${e(account(id)?.username)}</strong>. Confirm the account in-game before attaching.</p>${list.length ? list.map((w, i) => `<button type="button" class="window-option" data-action="window.choose" data-index="${i}">${icon('monitor')}<div><strong>${e(w.title || 'Roblox')}</strong><p>Process ${w.pid} · ${w.minimized ? 'Minimized' : 'Visible'}</p></div></button>`).join('') : '<div class="notice">No Roblox windows found. Launch Roblox on this computer, then try again.</div>'}`, cancel());
  modal.querySelectorAll('[data-action="window.choose"]').forEach(b => b.addEventListener('click', async () => { try { await call('windows.attach', { id, window: list[Number(b.dataset.index)] }); modal.close(); activeId = id; streamWanted = true; await refresh(true); toast('Window attached.'); } catch (err) { toast(err.message, true); } }));
}
function pairMachine() { showModal('Pair another machine', '<p>On the host PC, open Settings → Machine hosting, enable network hosting, then show its pairing details. Keep Orbit open on both PCs.</p><label>Machine name<input name="name" placeholder="e.g. Gaming PC" maxlength="80" required></label><label>HTTPS address<input name="address" placeholder="https://192.168.1.20:43128" type="url" required></label><label>SHA-256 certificate fingerprint<input name="fingerprint" class="mono" placeholder="Copy the fingerprint from the host" maxlength="100" required></label><label>Pairing token<input name="token" type="password" autocomplete="off" maxlength="100" required></label><p class="help">Anyone with these pairing details can manage accounts shared by the host. Share them only with your own controller.</p>', cancel() + submit('Pair machine'), async fd => { await call('machines.pair', Object.fromEntries(fd)); modal.close(); toast('Machine paired.'); }); }
async function pairingDetails() { const p = await call('host.pairing'); showModal('Pairing details', `<p>Enter these details in Orbit on your controller PC. The fingerprint verifies this host before the token is sent.</p><label>Host address<div class="secret-value">${e(p.address)}</div></label><label>SHA-256 fingerprint<div class="secret-value mono">${e(p.fingerprint)}</div></label><label>Pairing token<div class="secret-value mono">${e(p.token)}</div></label><div class="notice warning">${icon('lock')}Keep the token private. Rotate it in Settings to revoke all paired controllers.</div>`, btn('pairing.copy', 'Copy details', 'copy', 'primary', 'type="button"') + btn('modal.close', 'Done', '', '', 'type="button"')); modal.querySelector('[data-action="pairing.copy"]').addEventListener('click', () => call('clipboard.copy', { value: `${p.address}\n${p.fingerprint}\n${p.token}` }).then(() => toast('Pairing details copied.')).catch(err => toast(err.message, true))); }
function scheduleModal() { const options = state.accounts.filter(a => !a.peerId); if (!options.length) return toast('Connect an account on this machine first.', true); const dt = new Date(Date.now() + 3600000); dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset()); showModal('Schedule a session', `<label>Schedule name<input name="name" maxlength="80" placeholder="Evening session" required></label><div class="formgrid"><label>Action<select name="action"><option value="launch">Launch accounts</option><option value="stop">Stop accounts</option></select></label><label>Local date and time<input type="datetime-local" name="at" value="${dt.toISOString().slice(0,16)}" required></label></div><label>Repeat<select name="recurrence"><option value="once">Once · Free</option><option value="daily">Daily · Plus / Pro</option><option value="weekly">Weekly · Plus / Pro</option></select></label><label>Accounts</label><div class="checklist">${options.map(a => `<label class="checklabel"><input type="checkbox" name="ids" value="${e(a.id)}" ${selected.has(a.id) ? 'checked' : ''}>${e(a.username)}</label>`).join('')}</div><p class="help">This PC and Orbit must be running at the scheduled time.</p>`, cancel() + submit('Create schedule'), async fd => { const ids = fd.getAll('ids'); if (!ids.length) throw new Error('Select at least one account.'); await call('schedules.add', { name: fd.get('name'), action: fd.get('action'), recurrence: fd.get('recurrence'), at: new Date(fd.get('at')).getTime(), accountIds: ids }); modal.close(); toast('Schedule created.'); }); }
function backupModal(mode) { showModal(mode === 'export' ? 'Export encrypted backup' : 'Import encrypted backup', `<p>${mode === 'export' ? 'Your backup includes account login sessions. Choose a strong separate passphrase and keep it somewhere safe. Pairing tokens are excluded.' : 'Choose an Orbit backup and enter its passphrase. Accounts are merged; existing accounts are kept.'}</p><label>Backup passphrase<input type="password" name="passphrase" autocomplete="new-password" minlength="12" maxlength="1024" required placeholder="At least 12 characters"></label>${mode === 'export' ? '<label>Repeat passphrase<input type="password" name="confirm" minlength="12" maxlength="1024" required autocomplete="new-password"></label>' : ''}`, cancel() + submit(mode === 'export' ? 'Choose save location' : 'Choose backup'), async fd => { if (mode === 'export' && fd.get('passphrase') !== fd.get('confirm')) throw new Error('Passphrases do not match.'); const saved = await call(`backup.${mode}`, { passphrase: fd.get('passphrase') }); if (saved) { modal.close(); toast(mode === 'export' ? 'Encrypted backup saved.' : 'Backup imported.'); } }); }
function openQueue() { const q = state.queue; showModal('Launch queue', `<div class="notice ${q.paused ? 'warning' : ''}">${icon(q.paused ? 'pause' : 'clock')}${e(q.paused ? q.reason || 'Paused' : 'Queue is ready')}</div><p>${q.active.length} launching · ${q.pending.length} waiting · ${(state.settings.launchDelayMs / 1000)}s between launches</p>${q.pending.map(id => `<div class="row">${icon('clock')}<span>${e(account(id)?.username || id)}</span></div>`).join('')}${!q.pending.length ? '<p>No accounts are waiting.</p>' : ''}`, cancel() + btn(q.paused ? 'queue.resume' : 'queue.pause', q.paused ? 'Resume queue' : 'Pause queue', q.paused ? 'play' : 'pause', 'primary', 'type="button"')); }
async function openTheatre(id, control = false) {
  const a = account(id); if (!a) return;
  if (theatre?.id === id && modal.open) return;
  streamWanted = true;
  showModal(`${a.username} · ${demo ? 'Sample session' : 'Live preview'}`, `${frameMarkup(a, true)}<div class="theatre-controls">${btn('control.toggle', a.peerId || demo ? 'Take control' : 'Play here', 'mouse', 'primary', 'id="control-button" type="button"')}${btn('screenshot', 'Screenshot', 'camera', '', `data-id="${e(a.id)}" type="button"`)}<span class="muted" id="latency">${demo ? 'Illustrated sample · no live connection' : 'Connecting to the host…'}</span></div><p class="help">${a.peerId ? 'Input controls the foreground game on the host PC. Audio and pointer-lock camera controls are not supported in this version.' : 'Play here displays the actual game inside Orbit at its own frame rate, with normal keyboard, mouse and sound. Click inside to play. Use windowed mode. Return to preview restores the separate game window.'}${a.peerId ? ' Press Escape to release remote control.' : ''}</p>`, btn('theatre.fullscreen', 'Fullscreen', 'expand', '', 'type="button"') + btn('modal.close', 'Close session', '', '', 'type="button"'), null, 'theatre');
  const t = theatre = { id, controlling: false, localPlaying: false, busy: false };
  const surface = modal.querySelector('#remote-surface');
  const resize = () => { if (theatre !== t || !t.localPlaying || t.resizeBusy) return; t.resizeBusy = true; call('play.resize', { id, bounds: localBounds() }).catch(err => toast(err.message, true)).finally(() => { t.resizeBusy = false; }); };
  const observer = new ResizeObserver(resize); if (surface) observer.observe(surface);
  window.addEventListener('resize', resize);
  modal.addEventListener('scroll', resize, true);
  document.addEventListener('fullscreenchange', resize);
  modalClose = async () => { observer.disconnect(); modal.removeEventListener('scroll', resize, true); window.removeEventListener('resize', resize); document.removeEventListener('fullscreenchange', resize); if (theatre === t) theatre = null; if (!demo) await call(a.peerId ? 'control.release' : 'play.close', { id }).catch(() => {}); };
  wireRemoteInput(); await updateFrames(); if (control && !demo) await toggleControl();
}
function localBounds() {
  const r = modal.querySelector('#remote-surface').getBoundingClientRect();
  return { x: Math.max(0, Math.ceil(r.x)), y: Math.max(0, Math.ceil(r.y)), width: Math.floor(r.width), height: Math.floor(r.height), viewportWidth: innerWidth, viewportHeight: innerHeight };
}
async function toggleControl() {
  const t = theatre;
  if (!t || t.busy) return;
  if (demo) return toast('Demo session only. No real game is being controlled.');
  const a = account(t.id), b = modal.querySelector('#control-button');
  t.busy = true; if (b) b.disabled = true;
  try {
    if (!a.peerId) {
      if (t.localPlaying) { await call('play.close', { id: t.id }); t.localPlaying = false; }
      else {
        await call('play.open', { id: t.id, bounds: localBounds() });
        if (theatre !== t) { await call('play.close', { id: t.id }); return; }
        t.localPlaying = true;
      }
    } else if (t.controlling) { await call('control.release', { id: t.id }); t.controlling = false; }
    else { await call('control.take', { id: t.id }); if (theatre !== t) { await call('control.release', { id: t.id }); return; } t.controlling = true; }
    if (theatre !== t) return;
    if (b) { b.innerHTML = icon('mouse') + `<span>${a.peerId ? t.controlling ? 'Release control' : 'Take control' : t.localPlaying ? 'Return to preview' : 'Play here'}</span>`; b.classList.toggle('danger', t.controlling || t.localPlaying); }
    const surface = modal.querySelector('#remote-surface'); surface?.classList.toggle('controlling', t.controlling); surface?.classList.toggle('native-playing', t.localPlaying);
    if (t.controlling) surface?.focus();
    const latency = modal.querySelector('#latency'); if (latency && t.localPlaying) latency.textContent = 'Native local play · game frame rate · click inside to play';
  } finally { t.busy = false; if (b?.isConnected) b.disabled = false; }
}
async function sendInput(event) { if (!theatre?.controlling) return; try { await call('control.input', { id: theatre.id, event }); } catch (err) { if (theatre) { theatre.controlling = false; call('control.release', { id: theatre.id }).catch(() => {}); } toast(err.message, true); modal.querySelector('#remote-surface')?.classList.remove('controlling'); const b = modal.querySelector('#control-button'); if (b) b.innerHTML = icon('mouse') + '<span>Take control</span>'; } }
function wireRemoteInput() {
  const surface = modal.querySelector('#remote-surface'); if (!surface) return;
  const point = ev => { const image = surface.querySelector('img'), rect = surface.getBoundingClientRect(); const ratio = image?.naturalWidth / image?.naturalHeight || 16/9; let w = rect.width, h = w / ratio; if (h > rect.height) { h = rect.height; w = h * ratio; } return { x: Math.max(0, Math.min(1, (ev.clientX - rect.left - (rect.width - w) / 2) / w)), y: Math.max(0, Math.min(1, (ev.clientY - rect.top - (rect.height - h) / 2) / h)) }; };
  surface.addEventListener('contextmenu', ev => ev.preventDefault());
  surface.addEventListener('mousemove', async ev => { if (!theatre?.controlling || mouseBusy || Date.now() - lastMouse < 45) return; lastMouse = Date.now(); mouseBusy = true; await sendInput({ type: 'mousemove', ...point(ev) }); mouseBusy = false; });
  for (const type of ['mousedown', 'mouseup']) surface.addEventListener(type, ev => { if (!theatre?.controlling || ![0,2].includes(ev.button)) return; ev.preventDefault(); surface.focus(); sendInput({ type, button: ev.button, ...point(ev) }); });
  surface.addEventListener('wheel', ev => { if (!theatre?.controlling) return; ev.preventDefault(); sendInput({ type: 'wheel', delta: Math.max(-10000, Math.min(10000, ev.deltaY)), ...point(ev) }); }, { passive: false });
  const keys = { Space: 32, Enter: 13, Backspace: 8, Tab: 9, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34, CapsLock: 20, Minus: 189, Equal: 187, Comma: 188, Period: 190, Slash: 191, Backquote: 192, BracketLeft: 219, BracketRight: 221, Backslash: 220, Semicolon: 186, Quote: 222 };
  for (const type of ['keydown', 'keyup']) surface.addEventListener(type, ev => { if (!theatre?.controlling || ev.key === 'Escape') return; ev.preventDefault(); if (ev.repeat) return; const key = keys[ev.code] || (/^Key[A-Z]$/.test(ev.code) ? ev.code.charCodeAt(3) : /^Digit\d$/.test(ev.code) ? Number(ev.code.slice(5)) + 48 : 0); if (key) sendInput({ type, key }); });
}
function validFrame(frame) { return frame && typeof frame.data === 'string' && frame.data.length < 2_500_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(frame.data); }
async function updateFrames() {
  if (!state || demo || theatre?.localPlaying || theatre?.busy || frameBusy || document.hidden || Date.now() < nextFrameAt) return;
  const ids = theatre ? [theatre.id] : streamWanted ? page === 'Live view' ? filtered().filter(a => a.windowAttached).slice(0,9).map(a => a.id) : details && activeId && account(activeId)?.windowAttached ? [activeId] : [] : [];
  if (!ids.length) return;
  frameBusy = true; nextFrameAt = Date.now() + 1000 / state.settings.previewFps;
  try {
    for (const id of ids) {
      if (theatre?.localPlaying || theatre?.busy) break;
      const started = performance.now();
      try { const frame = await call('frame', { id }); if (!validFrame(frame)) throw new Error('Invalid image from the host.'); cachedFrames.set(id, frame); frameLatency = Math.round(performance.now() - started); frameError = '';
        const target = theatre?.id === id ? modal.querySelector('#remote-surface') : page === 'Live view' ? [...document.querySelectorAll('[data-grid-frame]')].find(el => el.dataset.gridFrame === id)?.querySelector('.preview') : id === activeId ? document.querySelector('#detail-frame .preview') : null;
        if (target && !theatre?.localPlaying) { let img = target.querySelector('img'); if (!img) { target.innerHTML = `<img alt="Live Roblox window preview" draggable="false"><span class="preview-badge"><span class="dot green"></span>LIVE PREVIEW · ${state.settings.previewFps} FPS</span>`; img = target.querySelector('img'); } img.src = frame.data; }
        const latency = modal.querySelector('#latency'); if (theatre && !theatre.localPlaying && latency) latency.textContent = `${state.settings.previewFps} FPS target · ${frameLatency} ms frame request · ${time(frame.at)}`;
      } catch (err) { frameError = err.message; const latency = modal.querySelector('#latency'); if (latency) latency.textContent = frameError; }
    }
  } finally { frameBusy = false; }
}
function accountMenu(id, anchor) {
  document.querySelector('.popup')?.remove(); const a = account(id); if (!a) return;
  const el = document.createElement('div'); el.className = 'popup'; el.innerHTML = `${btn('account.launch', 'Launch', 'play', '', `data-id="${e(id)}"`)}${btn('window.attach', 'Attach game window', 'link', '', `data-id="${e(id)}" ${a.peerId ? 'disabled' : ''}`)}${btn('account.edit', 'Edit account', 'settings', '', `data-id="${e(id)}" ${a.peerId ? 'disabled' : ''}`)}${btn('account.verify', 'Sign in / verify', 'shield', '', `data-id="${e(id)}" ${a.peerId ? 'disabled' : ''}`)}${btn('account.stop', 'Stop session', 'stop', 'danger', `data-id="${e(id)}"`)}${!a.peerId ? btn('account.remove', 'Remove account', 'trash', 'danger', `data-id="${e(id)}"`) : ''}`;
  document.body.append(el); const r = anchor.getBoundingClientRect(); el.style.left = `${Math.max(5, Math.min(window.innerWidth - 200, r.right - 190))}px`; el.style.top = `${Math.max(5, Math.min(window.innerHeight - el.offsetHeight - 10, r.bottom + 5))}px`;
}
function activationModal() {
  const keyauth = state.license?.provider === 'keyauth';
  showModal(keyauth ? 'Activate a KeyAuth key' : 'Activate an Orbit key', `<p>Paste the complete key you received. ${keyauth ? 'KeyAuth keys are case-sensitive. An online check is required for paid features.' : 'It unlocks only its assigned features and never changes your Roblox sign-in.'}</p><label>Activation key<input name="key" autocomplete="off" spellcheck="false" maxlength="100" required placeholder="${keyauth ? 'Your KeyAuth license key' : 'ORBIT-…'}"></label>`, cancel() + submit('Activate key'), async fd => { const raw = String(fd.get('key')).trim(); await call('license.activate', { key: keyauth ? raw : raw.toUpperCase() }); modal.close(); toast('License activated.'); });
}
function serviceModal(provider = state.license?.provider || 'keyauth') {
  const l = state.license || {}, k = l.keyauth || {}, keyauth = provider === 'keyauth';
  const switcher = `<div class="row">${btn('license.configure.keyauth', 'KeyAuth', '', keyauth ? 'primary' : '', 'type="button"')}${btn('license.configure.orbit', 'Self-hosted service', '', !keyauth ? 'primary' : '', 'type="button"')}</div>`;
  const fields = keyauth ? `<p>Enter the public application details from your KeyAuth dashboard. Saving this connection requires fresh key activation.</p><input type="hidden" name="provider" value="keyauth"><label>Application name<input name="name" value="${e(k.name || '')}" maxlength="100" required autocomplete="off"></label><label>Owner ID<input name="ownerid" value="${e(k.ownerid || '')}" pattern="[a-zA-Z0-9]{10}" maxlength="10" required autocomplete="off"></label><label>KeyAuth application version<input name="version" value="${e(k.version || '1.0')}" maxlength="30" required></label><div class="form-grid"><label>Plus subscription name<input name="plus" value="${e(k.subscriptions?.plus || 'plus')}" maxlength="100" required></label><label>Pro subscription name<input name="pro" value="${e(k.subscriptions?.pro || 'pro')}" maxlength="100" required></label></div><p>Use the exact subscription names from KeyAuth. No app secret, seller key, or account password is needed.</p>` : `<input type="hidden" name="provider" value="orbit"><p>Use the publisher's HTTPS service address and public verification key. The private signing key stays on the server.</p><label>Service URL<input type="url" name="serverUrl" value="${e(l.provider === 'keyauth' ? '' : l.serverUrl || '')}" placeholder="https://licenses.example.com" required></label><label>Public verification key<textarea name="publicKey" rows="5" required placeholder="-----BEGIN PUBLIC KEY-----">${e(l.publicKey || '')}</textarea></label>`;
  showModal('Connect a license service', switcher + fields, cancel() + submit('Connect service'), async fd => {
    const raw = Object.fromEntries(fd);
    await call('license.configure', keyauth ? { provider: 'keyauth', keyauth: { name: raw.name, ownerid: raw.ownerid, version: raw.version, subscriptions: { ...(k.subscriptions || {}), plus: raw.plus, pro: raw.pro } } } : raw);
    modal.close(); toast('License service connected.');
  });
}
async function licenseDevices() {
  const result = await call('license.devices');
  showModal('Activated installations', `<p>${result.devices.filter(d => d.active).length} of ${result.maxActivations} installation slots in use. Managed-PC limits are shown separately in your plan.</p>${result.devices.map(d => `<div class="card"><strong>${e(d.name)}</strong><p>${d.active ? 'Active' : 'Inactive'} · Last seen ${date(d.lastSeenAt)}</p>${d.active ? btn('license.deactivate', 'Deactivate', '', 'small', `type="button" data-device="${e(d.deviceId)}"`) : ''}</div>`).join('') || '<p>No installations found.</p>'}`, cancel());
}
function workflowModal() {
  const options = state.accounts.filter(a => !a.peerId);
  if (!options.length) return toast('Connect local accounts before creating a workflow.', true);
  showModal('Save a workflow', `<label>Workflow name<input name="name" maxlength="80" required></label><label>Action<select name="action"><option value="launch">Launch accounts</option><option value="stop">Stop accounts</option></select></label><div class="checklist">${options.map(a => `<label class="checklabel"><input type="checkbox" name="ids" value="${e(a.id)}" ${selected.has(a.id) ? 'checked' : ''}>${e(a.username)}</label>`).join('')}</div>`, cancel() + submit('Save workflow'), async fd => { await call('workflows.save', { name: fd.get('name'), action: fd.get('action'), accountIds: fd.getAll('ids') }); modal.close(); toast('Workflow saved.'); });
}
async function handle(action, data, el) {
  if (!action) return;
  if (action !== 'account.menu') document.querySelector('.popup')?.remove();
  switch (action) {
    case 'license.activate.open': activationModal(); return;
    case 'license.configure.open': serviceModal(); return;
    case 'license.configure.keyauth': serviceModal('keyauth'); return;
    case 'license.configure.orbit': serviceModal('orbit'); return;
    case 'license.refresh': await call('license.refresh'); toast('License checked.'); break;
    case 'license.devices': await licenseDevices(); return;
    case 'license.deactivate': confirm('Deactivate installation?', 'This frees an installation slot. The selected PC returns to Free when it checks its license.', async () => { await call('license.deactivate', { deviceId: data.device }); }, 'Deactivate'); return;
    case 'license.forget': confirm('Remove this key?', 'Remove the activation key from this PC. Your Roblox accounts stay saved. This does not reset a KeyAuth HWID binding or free a server activation slot.', () => call('license.forget'), 'Remove key'); return;
    case 'license.trial': await call('license.trial'); toast('Trial activated.'); break;
    case 'license.checkout': await call('license.checkout', { offer: data.offer }); toast('Checkout opened in your browser. Return here after paying.'); break;
    case 'license.purchase.cancel': confirm('Cancel pending checkout?', 'Orbit will expire the unfinished checkout. A completed or processing payment must be checked first.', async () => { const result = await call('license.purchase.cancel'); toast(result.paid ? 'Payment confirmed. License activated.' : 'Unfinished checkout cancelled.'); }, 'Cancel checkout'); return;
    case 'license.purchase': { const result = await call('license.purchase'); toast(result.paid ? 'Purchase confirmed. License activated.' : 'Payment has not been confirmed yet.'); break; }
    case 'license.billing': await call('license.billing'); return;
    case 'updates.check': await call('updates.check'); break;
    case 'updates.install': await call('updates.install'); return;
    case 'workflow.add': workflowModal(); return;
    case 'workflow.remove': confirm('Delete workflow?', 'Remove this saved workflow? Running games stay open.', () => call('workflows.remove', { id: data.id }), 'Delete'); return;
    case 'workflow.run': confirm('Run workflow?', 'Apply the saved launch or stop action to its accounts?', () => call('workflows.run', { id: data.id }), 'Run workflow'); return;
    case 'activity.export': if (await call('activity.export')) toast('History exported.'); return;
    case 'nav': page = data.page; query = ''; statusFilter = ''; machineFilter = ''; render(); return;
    case 'group': page = 'Accounts'; group = data.group; statusFilter = ''; query = ''; pageNumber = 1; render(); return;
    case 'group.add': groupModal(); return;
    case 'commands': commandPalette(); return;
    case 'launch.settings': await launchSettings(); return;
    case 'group.rename': { const name = data.name; showModal('Rename group', `<label>Group name<input name="name" value="${e(name)}" maxlength="80" required></label>`, cancel() + submit(), async fd => { await call('groups.rename', { name, next: fd.get('name') }); group = fd.get('name'); modal.close(); }); return; }
    case 'group.delete': confirm('Remove empty group?', 'Move its accounts to another group first. Its launch configuration will be removed.', async () => { await call('groups.remove', { name: data.name }); if (group === data.name) group = ''; }, 'Remove group'); return;
    case 'server.add': serverModal(); return;
    case 'server.edit': serverModal(data.id); return;
    case 'server.remove': confirm('Remove private server?', 'Remove this invite and clear account assignments that use it?', () => call('servers.remove', { id: data.id }), 'Remove'); return;
    case 'sessions.paste': importSessions(); return;
    case 'sessions.files': { const content = await call('sessions.files'); if (content !== null) { const field = modal.querySelector('[name="sessions"]'); if (field) field.value += (field.value ? '\n' : '') + content; } return; }
    case 'signin.builtin': await signIn(); return;
    case 'signin.browser': await startBrowserLogin(); return;
    case 'health.check': { const ids = (selected.size ? [...selected].map(account) : state.accounts).filter(a => !a.peerId).map(a => a.id); const r = await call('accounts.health', { ids }); toast(`Health: ${r.alive} alive · ${r.dead} expired · ${r.unknown} unknown · ${r.skipped} skipped`); break; }
    case 'operation.cancel': await call('operation.cancel'); toast('Stopping after the current check.'); break;
    case 'account.relaunch': confirm('Relaunch account?', 'Close this account’s current game window and launch it again using its group settings?', () => call('accounts.relaunch', { id: data.id }), 'Relaunch'); return;
    case 'monitor.overlay': await call('monitor.open', { mode: 'overlay' }); return;
    case 'monitor.popout': await call('monitor.open', { mode: 'popout' }); return;
    case 'account.add': addAccounts(); return;
    case 'account.verify': await signIn(data.id); return;
    case 'account.edit': editAccount(data.id); return;
    case 'account.menu': accountMenu(data.id, el); return;
    case 'account.remove': confirm('Remove account?', `Remove ${account(data.id)?.username} and its saved session from this machine?`, () => call('accounts.remove', { id: data.id }), 'Remove'); return;
    case 'account.launch': await call('accounts.launch', { ids: [data.id] }); toast('Added to launch queue.'); break;
    case 'account.stop': confirm('Stop session?', 'Close the attached Roblox window for this account?', () => call('accounts.stop', { ids: [data.id] }), 'Stop session'); return;
    case 'bulk.launch': case 'bulk.reconnect': await call('accounts.launch', { ids: [...selected] }); toast('Eligible accounts added to the launch queue. Verification and expired accounts need sign-in first.'); break;
    case 'bulk.organize': { const ids = [...selected].filter(id => !account(id)?.peerId); if (!ids.length) return toast('Organize remote accounts on their host PC.', true); showModal('Organize selected accounts', `<p>Update ${ids.length} selected local accounts together. Remote accounts are managed on their hosts.</p><label>Group<select name="group">${state.groups.map(g => `<option>${e(g)}</option>`).join('')}</select></label><label>Launch profile<select name="profileId"><option value="">Keep current profiles</option>${state.profiles.map(p => `<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}</select></label>`, cancel() + submit('Apply to accounts'), async fd => { await call('accounts.organize', { ids, group: fd.get('group'), profileId: fd.get('profileId') }); modal.close(); toast('Selected accounts updated.'); }); return; }
    case 'bulk.stop': confirm('Stop selected sessions?', `Close attached Roblox windows for ${selected.size} selected accounts?`, () => call('accounts.stop', { ids: [...selected] }), 'Stop sessions'); return;
    case 'stop.all': confirm('Stop all managed sessions?', 'Cancel the launch queue and close attached Roblox windows on this PC and connected machines.', () => call('accounts.stopAll'), 'Stop all'); return;
    case 'selection.clear': selected.clear(); render(); return;
    case 'details.toggle': details = !details; render(); return;
    case 'page.prev': pageNumber--; render(); return;
    case 'page.next': pageNumber++; render(); return;
    case 'filters.clear': group = ''; query = ''; statusFilter = ''; machineFilter = ''; render(); return;
    case 'attention': page = 'Accounts'; group = ''; query = ''; statusFilter = 'attention'; pageNumber = 1; render(); return;
    case 'window.attach': await attachWindow(data.id); return;
    case 'window.choose': return;
    case 'preview.start': activeId = data.id; streamWanted = true; await updateFrames(); return;
    case 'preview.all': streamWanted = !streamWanted; render(); await updateFrames(); return;
    case 'remote.open': await openTheatre(data.id, true); return;
    case 'watch.open': await openTheatre(data.id); return;
    case 'control.toggle': await toggleControl(); return;
    case 'theatre.fullscreen': await modal.requestFullscreen(); return;
    case 'screenshot': if (await call('screenshot', { id: data.id })) toast('Screenshot saved.'); return;
    case 'machine.pair': pairMachine(); return;
    case 'machine.remove': confirm('Unpair machine?', 'Remove this machine from your controller. Existing game sessions on it will keep running.', () => call('machines.remove', { id: data.id }), 'Unpair'); return;
    case 'host.settings': page = 'Settings'; render(); return;
    case 'host.pairing': await pairingDetails(); return;
    case 'host.rotate': confirm('Rotate pairing token?', 'Previously paired controllers will lose access until paired again with the new token.', () => call('host.rotate'), 'Rotate token'); return;
    case 'pairing.copy': return;
    case 'schedule.add': scheduleModal(); return;
    case 'schedule.remove': await call('schedules.remove', { id: data.id }); break;
    case 'profile.edit': profileModal(data.id); return;
    case 'profile.add': profileModal(); return;
    case 'launcher.pick': { const path = await call('launcher.pick'); if (path) document.querySelector('#launcher-path').value = path; return; }
    case 'launcher.clear': document.querySelector('#launcher-path').value = ''; return;
    case 'settings.submit': return;
    case 'backup.export': backupModal('export'); return;
    case 'backup.import': backupModal('import'); return;
    case 'queue.open': openQueue(); return;
    case 'queue.pause': await call('queue.pause'); modal.close(); break;
    case 'queue.resume': await call('queue.resume'); modal.close(); break;
    case 'modal.close': modal.close(); return;
    case 'demo.enter': if (modal.open) modal.close(); demo = true; state = sampleState(); activeId = state.accounts[2].id; selected = new Set([activeId]); page = 'Accounts'; group = ''; query = ''; statusFilter = ''; machineFilter = ''; cachedFrames.clear(); render(); return;
    case 'demo.exit': demo = false; selected.clear(); activeId = null; query = ''; group = ''; statusFilter = ''; machineFilter = ''; streamWanted = false; cachedFrames.clear(); if (bridge) await refresh(true); else { state = emptyState(); render(); } return;
    case 'link.open': await call('link.open', { id: data.id }); return;
    case 'window.minimize': case 'window.maximize': case 'window.close': await call(action); return;
    default: return;
  }
  await refresh(true);
}
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-action]');
  if (el) { if (el.dataset.busy) return; el.dataset.busy = 'true'; try { await handle(el.dataset.action, el.dataset, el); } catch (err) { toast(err.message, true); } finally { delete el.dataset.busy; } return; }
  if (!ev.target.closest('.popup')) document.querySelector('.popup')?.remove();
  const row = ev.target.closest('[data-account]'); if (row && !ev.target.closest('input,select,button')) { activeId = row.dataset.account; details = true; frameError = ''; streamWanted = true; render(); updateFrames(); }
});
document.addEventListener('input', ev => { if (ev.target.id !== 'search') return; query = ev.target.value; pageNumber = 1; const at = ev.target.selectionStart; render(); const input = document.querySelector('#search'); input.focus(); input.setSelectionRange(at, at); });
document.addEventListener('change', async ev => {
  if (ev.target.dataset.inline) { try { await call('accounts.update', { id: ev.target.dataset.id, [ev.target.dataset.inline]: ev.target.value }); await refresh(true); } catch (err) { toast(err.message, true); await refresh(true); } return; }
  if (ev.target.dataset.select) { ev.target.checked ? selected.add(ev.target.dataset.select) : selected.delete(ev.target.dataset.select); render(); }
  if (ev.target.id === 'select-page') { const list = filtered().slice((pageNumber - 1) * pageSize, pageNumber * pageSize); for (const a of list) ev.target.checked ? selected.add(a.id) : selected.delete(a.id); render(); }
  if (ev.target.id === 'status-filter') { statusFilter = ev.target.value; pageNumber = 1; render(); }
  if (ev.target.id === 'machine-filter') { machineFilter = ev.target.value; pageNumber = 1; render(); }
});
document.addEventListener('submit', async ev => {
  if (ev.target.id === 'update-settings') { ev.preventDefault(); const fd = new FormData(ev.target); try { await call('updates.configure', { autoUpdate: fd.has('autoUpdate'), updateChannel: fd.get('updateChannel') }); toast('Update preferences saved.'); await refresh(true); } catch (err) { toast(err.message, true); } return; }
  if (ev.target.id !== 'settings-form') return; ev.preventDefault();
  const fd = new FormData(ev.target); const b = ev.target.querySelector('[type=submit]'); b.disabled = true;
  try { await call('settings.save', { launchDelayMs: Number(fd.get('launchDelay')) * 1000, maxConcurrent: Number(fd.get('maxConcurrent')), launcherPath: fd.get('launcherPath'), hostEnabled: fd.has('hostEnabled'), hostBind: fd.get('hostBind'), hostPort: Number(fd.get('hostPort')), allowRemoteControl: fd.has('allowRemoteControl'), previewFps: Number(fd.get('previewFps')), multiSession: fd.has('multiSession'), desktopAlerts: fd.has('desktopAlerts'), theme: fd.get('theme') }); toast('Settings saved.'); await refresh(true); } catch (err) { toast(err.message, true); } finally { if (b.isConnected) b.disabled = false; }
});
document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); commandPalette(); }
  if (ev.key === 'Escape' && theatre?.controlling) { ev.preventDefault(); toggleControl().catch(err => toast(err.message, true)); }
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-account]')) { ev.preventDefault(); activeId = ev.target.dataset.account; details = true; streamWanted = true; render(); updateFrames(); }
});
modal.addEventListener('cancel', ev => { if (theatre?.controlling) { ev.preventDefault(); toggleControl().catch(() => {}); } });
modal.addEventListener('close', () => { if (modal.open) return; const fn = modalClose; modalClose = null; fn?.(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); });
window.addEventListener('blur', () => { if (theatre?.controlling) toggleControl().catch(() => {}); });
document.addEventListener('mouseup', ev => { if (theatre?.controlling && !ev.target.closest('#remote-surface') && [0,2].includes(ev.button)) sendInput({ type: 'mouseup', button: ev.button, x: 0, y: 0 }); });
window.addEventListener('beforeunload', () => { if (theatre?.controlling) call('control.release', { id: theatre.id }).catch(() => {}); });
function emptyState() { const s = sampleState(); return { ...s, accounts: [], machines: [], activity: [], secureStorage: false, platform: 'browser', queue: { pending: [], active: [], paused: false, nextAt: 0, reason: '' } }; }
if (bridge) { state = await call('state'); bridge.onChange(() => refresh()); render(); }
else { state = emptyState(); if (location.hash === '#demo') { demo = true; state = sampleState(); activeId = state.accounts[2].id; selected.add(activeId); } render(); }
setInterval(() => refresh(), 5000);
setInterval(() => updateFrames(), 100);
setInterval(() => { if (theatre?.controlling) sendInput({ type: 'heartbeat' }); }, 2500);

setInterval(() => { for (const node of document.querySelectorAll('[data-countdown]')) node.textContent = `Relaunching in ${Math.max(0, Math.ceil((Number(node.dataset.countdown) - Date.now()) / 1000))}s`; }, 1000);

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
