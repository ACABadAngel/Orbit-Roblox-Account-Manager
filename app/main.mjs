import { app, BrowserWindow, ipcMain, session, safeStorage, shell, dialog, desktopCapturer, clipboard, Notification } from 'electron';
import electronUpdater from 'electron-updater';
import { LicenseClient } from './core/license-client.mjs';
import { UpdateManager } from './core/updater.mjs';
import { requireFeature, requireRemote, requireBulk } from './core/plans.mjs';
import { randomUUID, randomBytes, X509Certificate } from 'node:crypto';
import os from 'node:os';
import { screen } from 'electron';
import { LAUNCH_DEFAULTS, launchConfig, effectiveConfig, privateServer, chooseServer, scheduleRecovery, processMetrics } from './core/account-manager.mjs';
import { AccountOperations } from './core/account-operations.mjs';
import { browserLogin } from './core/browser-login.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Store, encryptBackup, decryptBackup } from './core/storage.mjs';
import { activity, publicAccount, text, identifier, validateSettings, validateProfile, validateSchedule, validateState, makeLaunchUri, nextScheduleAt, validateWorkflow } from './core/model.mjs';
import { authenticationTicket, authenticatedUser, avatarFor, gameDetails, resolvePrivateServer } from './core/roblox.mjs';
import { LaunchQueue } from './core/queue.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalPlay } from './core/local-play.mjs';
import { StreamHosts } from './stream-host.mjs';
import { inputEvent, streamOptions } from './core/playback.mjs';
import { layout as validateLayout, slotBounds } from './core/layouts.mjs';
import { globalShortcut } from 'electron';
import { NativeHost } from './core/native.mjs';
import { startHost, certificate, fingerprint, parsePeer, pinCertificate, peerRequest } from './core/remote.mjs';

const here = dirname(fileURLToPath(import.meta.url)), ui = join(here, 'renderer', 'index.html');
if (!app.isPackaged && process.env.ORBIT_TEST_DATA) app.setPath('userData', process.env.ORBIT_TEST_DATA);
let streams;
const expandedWindows = new Set(), audioApplied = new Map();
let win, store, queue, server, license, updates, operations, overlay, popout, hostError = '', quitting = false, pollsBusy = false;
const serverCursors = new Map(), browserLogins = new Map();
const native = new NativeHost(), logins = new Map(), peerStates = new Map(), frames = new Map(), remoteLeases = new Map();
let localMetrics = { id: 'local', name: os.hostname(), online: true, cpu: 0, ram: 0, totalRam: os.totalmem(), platform: process.platform };
const localPlay = new LocalPlay(native);
let previousCpu = os.cpus(), lease = null, launchHandoff = Promise.resolve(), controlPending = false;
const get = id => { const a = store.state.accounts.find(a => a.id === identifier(id)); if (!a) throw new Error('Account not found.'); return a; };
const persist = () => store.save();
const emit = () => { for (const window of [win, overlay, popout]) if (window && !window.isDestroyed()) window.webContents.send('orbit:changed'); };
function log(message, level = 'info', id = '') {
  activity(store.state, message, level, id); emit();
  if (level === 'warning' && store.state.settings.desktopAlerts && license?.status().features.alerts && Notification.isSupported()) new Notification({ title: 'Orbit · Session needs attention', body: message }).show();
}
function encryptionReady() { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'); }
function snapshot(localOnly = false) {
  const s = store.state;
  const remote = localOnly ? [] : [...peerStates.entries()].flatMap(([peerId, state]) => (state.accounts || []).map(a => ({ ...a, id: `${peerId}:${a.id}`, remoteId: a.id, peerId, machineId: peerId, status: state.online ? a.status : 'unknown' })));
  return { operation: operations?.progress || null, groupSettings: s.groupSettings || {}, privateServers: (s.privateServers || []).map(({ id, name, placeId }) => ({ id, name, placeId })), license: license?.status(), updates: updates?.snapshot(), workflows: s.workflows || [], localPlayId: localOnly ? null : localPlay.current, version: s.version, accounts: [...s.accounts.map(publicAccount), ...remote], groups: s.groups, profiles: s.profiles, settings: s.settings, machines: [{ ...localMetrics, accounts: s.accounts.length, running: s.accounts.filter(a => a.status === 'running').length }, ...(localOnly ? [] : s.peers.map(p => { const r = peerStates.get(p.id); return { id: p.id, name: p.name, address: p.address, online: Boolean(r?.online), cpu: r?.machine?.cpu || 0, ram: r?.machine?.ram || 0, totalRam: r?.machine?.totalRam || 0, accounts: r?.accounts?.length || 0, running: r?.accounts?.filter(a => a.status === 'running').length || 0, lastSeen: r?.lastSeen, error: r?.error || '' }; }))], queue: queue.snapshot, schedules: s.schedules, activity: license?.status().features.extendedHistory ? s.activity : s.activity.slice(0, 100), host: { enabled: Boolean(server), error: hostError, address: `https://${s.settings.hostBind === '0.0.0.0' ? (Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address || os.hostname()) : '127.0.0.1'}:${s.settings.hostPort}` }, secureStorage: encryptionReady(), platform: process.platform };
}
async function launch(id, cancelled) {
  // Attribute each newly created window before handing off the next launch.
  const previous = launchHandoff; let finish;
  launchHandoff = new Promise(resolve => { finish = resolve; });
  await previous;
  try { if (!cancelled()) await launchOne(id, cancelled); } finally { finish(); }
}
async function launchOne(id, cancelled) {
  const a = get(id), s = store.state;
  try {
    if (process.platform !== 'win32') throw new Error('Launching Roblox requires Windows.');
    const config = effectiveConfig(s, a), profile = { ...(s.profiles.find(p => p.id === (config.profileId || a.profileId)) || s.profiles[0]) };
    const server = chooseServer(config, a, s.privateServers || [], serverCursors);
    if (server) { profile.placeId = server.placeId; profile.name = server.name; profile.jobId = ''; } if (!profile?.placeId) throw new Error('Set a place ID in Settings → Launch profiles.');
    const cookie = store.secrets.accounts?.[id]; if (!cookie) throw new Error('Sign in again to connect this account.');
    a.status = 'launching'; a.error = ''; emit();
    if (s.settings.multiSession) await native.call('multi.enable').catch(e => { e.pauseQueue = true; throw e; });
    const before = await native.call('list');
    if (!s.settings.multiSession && before.length) throw new Error('A Roblox session is already open. Enable multiple sessions in Settings before launching another account.');
    if (server) { const secret = store.secrets.privateServers?.[server.id]; if (!secret) throw new Error('Re-enter this private server’s invite in Launch settings.'); Object.assign(profile, await resolvePrivateServer(secret, profile.placeId, cookie)); }
    const ticket = await authenticationTicket(cookie, profile.placeId);
    a.lastLaunchedAt = Date.now();
    if (cancelled()) { a.status = 'idle'; return; }
    const uri = makeLaunchUri(ticket, profile);
    if (s.settings.launcherPath) {
      const info = await stat(s.settings.launcherPath); if (!info.isFile()) throw new Error('The selected launcher is not a file.');
      await new Promise((resolve, reject) => { const child = spawn(s.settings.launcherPath, [uri], { detached: true, stdio: 'ignore', windowsHide: false }); child.once('error', () => reject(new Error('Could not start the configured launcher.'))); child.once('spawn', () => { child.unref(); resolve(); }); });
    } else await shell.openExternal(uri).catch(() => { throw new Error('No Roblox protocol handler found. Install Roblox or select Froststrap.'); });
    a.status = 'awaiting-window'; a.game = profile.name; a.lastSeen = Date.now();
    log(`Launch sent for ${a.username}. Waiting for its Roblox window.`, 'info', id);
    // A launch handoff is not proof of a running game. Only attach one unambiguous new window.
    const known = new Set(before.map(w => `${w.hwnd}:${w.started}`));
    for (let attempts = 0; attempts < 40; attempts++) {
      await delay(1000);
      if (cancelled() || a.status !== 'awaiting-window') return;
      const list = await native.call('list');
      const added = list.filter(w => !known.has(`${w.hwnd}:${w.started}`) && !s.accounts.some(other => other.id !== id && other.window?.hwnd === w.hwnd));
      if (added.length === 1) {
        a.window = added[0]; a.status = 'running'; a.startedAt = Date.now(); a.lastSeen = Date.now();
        await applyAutomaticLayout(a.id);
        log(`${a.username} connected to a Roblox window.`, 'info', id);
        if (before.some(old => !list.some(w => w.hwnd === old.hwnd && w.started === old.started))) { const reason = 'An earlier Roblox window closed during launch. Queue paused: check whether your launcher replaced that session.'; queue.pause(reason); log(reason, 'warning', id); }
        return;
      }
      if (added.length > 1) { const error = new Error('Several new Roblox windows appeared. Attach the correct window manually before launching another account.'); error.pauseQueue = true; throw error; }
    }
    const error = new Error('No new Roblox window appeared. Check your launcher and attach the correct window before retrying.');
    error.pauseQueue = true; throw error;
  } catch (e) { a.status = e.status || 'error'; a.error = e.message; log(`${a.username}: ${e.message}`, 'warning', id); throw e; }
  finally { await persist(); emit(); }
}
async function enqueue(ids, automatic = false) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5000) throw new Error('Select accounts first.');
  const accounts = [...new Set(ids)].map(get); for (const a of accounts) { if (!automatic) { a.relaunchAt = null; a.recoveryAttempts = []; } if (['running', 'launching', 'queued', 'awaiting-window'].includes(a.status)) continue; if (a.status === 'verification' || a.status === 'expired') continue; a.status = 'queued'; a.error = ''; }
  queue.enqueue(accounts.filter(a => a.status === 'queued').map(a => a.id)); await persist(); emit();
}
async function stopAccounts(ids) {
  queue.cancel(ids); for (const id of ids) { const a = get(id); a.relaunchAt = null; a.recoveryAttempts = []; }
  for (const id of ids) { const a = get(id); await streams?.stopAccount(id); await localPlay.close(id); if (lease?.accountId === id) await releaseControl(); if (a.window) await native.call('close', { window: a.window }); a.status = 'idle'; delete a.window; delete a.startedAt; expandedWindows.delete(id); frames.delete(id); delete a.metrics; log(`Stopped ${a.username}.`, 'info', id); }
  await persist(); emit();
}
async function loginStart(raw) {
  if (!encryptionReady()) throw new Error('OS-backed encryption is unavailable. Enable Windows credential protection or a supported system keyring.');
  if (logins.size >= 3) throw new Error('Finish an open sign-in window first.');
  const existing = raw.existingId ? get(raw.existingId) : null, group = existing?.group || text(raw.group || 'Main', 80), id = randomUUID();
  const ses = session.fromPartition(`orbit-login-${id}`); // In-memory: never persist Roblox login pages or cookies.
  ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
  if (existing && store.secrets.accounts?.[existing.id]) await ses.cookies.set({ url: 'https://www.roblox.com', domain: '.roblox.com', path: '/', name: '.ROBLOSECURITY', value: store.secrets.accounts[existing.id], secure: true, httpOnly: true, sameSite: 'no_restriction' });
  const login = new BrowserWindow({ width: 1020, height: 800, title: 'Roblox sign-in · Orbit', autoHideMenuBar: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const allowed = value => { try { const u = new URL(value); return u.protocol === 'https:' && ['roblox.com', 'arkoselabs.com', 'funcaptcha.com'].some(h => u.hostname === h || u.hostname.endsWith('.' + h)); } catch { return false; } };
  login.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  login.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  logins.set(id, { login, ses, existing, group });
  login.on('closed', () => { logins.delete(id); ses.clearStorageData().catch(() => {}); });
  await login.loadURL(existing?.status === 'verification' ? 'https://www.roblox.com/home' : 'https://www.roblox.com/login');
  return { id };
}
async function loginFinish(id) {
  const pending = logins.get(identifier(id)); if (!pending) throw new Error('The sign-in window was closed. Start again.');
  const cookies = await pending.ses.cookies.get({ name: '.ROBLOSECURITY', url: 'https://www.roblox.com' });
  const cookie = cookies[0]?.value; if (!cookie) throw new Error('Complete Roblox sign-in in the open window first.');
  const user = await authenticatedUser(cookie);
  if (pending.existing && pending.existing.userId !== user.id) throw new Error('Sign into the same Roblox account to reconnect it.');
  const profile = store.state.profiles.find(p => p.id === pending.existing?.profileId) || store.state.profiles[0];
  if (pending.existing?.status === 'verification' && profile?.placeId) await authenticationTicket(cookie, profile.placeId);
  let a = store.state.accounts.find(a => a.userId === user.id);
  if (!a) { a = { id: randomUUID(), userId: user.id, username: user.name, displayName: user.displayName || user.name, group: pending.group, profileId: profile.id, notes: '', addedAt: Date.now() }; store.state.accounts.push(a); }
  if (!a.window && !['queued','launching','awaiting-window'].includes(a.status)) { a.status = 'idle'; a.error = ''; } a.health = 'alive'; a.checkedAt = Date.now(); a.avatar = await avatarFor(user.id);
  store.secrets.accounts ||= {}; store.secrets.accounts[a.id] = cookie;
  if (!store.state.groups.includes(a.group)) store.state.groups.push(a.group);
  await persist(); pending.login.close(); log(`Connected ${a.username}.`, 'info', a.id); await persist(); return { id: a.id };
}
async function windows() { return process.platform === 'win32' ? await native.call('list') : []; }
async function attach(id, selected) {
  const a = get(id), available = await windows();
  const w = available.find(w => w.hwnd === selected.hwnd && w.pid === selected.pid && w.started === selected.started);
  if (!w) throw new Error('That Roblox window is no longer available.');
  if (store.state.accounts.some(other => other.id !== id && other.window?.hwnd === w.hwnd)) throw new Error('That window is attached to another account.');
  a.window = w; a.status = 'running'; a.startedAt ||= Date.now(); a.lastSeen = Date.now(); a.error = ''; await applyAutomaticLayout(a.id); await persist(); emit(); return true;
}
async function sourceFor(id, size = { width: 1280, height: 720 }) {
  const a = get(id); if (!a.window) throw new Error('Attach this account’s Roblox window first.');
  const all = await windows(); const attached = all.find(w => w.hwnd === a.window.hwnd && w.pid === a.window.pid && w.started === a.window.started); if (!attached) throw new Error('The attached window closed.');
  if (attached.minimized) throw new Error('Restore Roblox on the host PC to capture a fresh preview.');
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false });
  const source = sources.find(s => s.id.split(':')[1] === a.window.hwnd);
  if (!source) throw new Error('Window capture is unavailable. Restore the Roblox window if it is minimized.'); return source;
}
async function capture(id) {
  const cached = frames.get(id), minAge = 1000 / store.state.settings.previewFps;
  if (cached && Date.now() - cached.at < minAge) return cached;
  const source = await sourceFor(id), frame = { data: source.thumbnail.toDataURL(), at: Date.now(), geometry: await native.call('geometry', { window: get(id).window }) };
  if (frame.data.length > 2_500_000) throw new Error('Captured frame is too large.'); frames.set(id, frame); return frame;
}
async function takeControl(id, owner = 'local') {
  const a = get(id); if (!a.window) throw new Error('Attach a Roblox window first.');
  if (owner !== 'local' && !store.state.settings.allowRemoteControl) throw new Error('Enable remote input on the host in Settings first.');
  if (lease && lease.until < Date.now()) await releaseControl();
  if (localPlay.current || controlPending) throw new Error('Close local play or wait for the pending control request first.');
  if (lease) throw new Error('Another session already has control. Release it before taking control here.');
  controlPending = true;
  try {
  if (!(await native.call('focus', { window: a.window }))) throw new Error('Windows did not allow Roblox to take focus. Bring it forward on the host and try again.');
  lease = { owner, accountId: id, keys: new Set(), until: Date.now() + 10000, token: randomBytes(32).toString('hex') }; emit(); return { leaseToken: lease.token };
  } finally { controlPending = false; }
}
async function releaseControl(owner) {
  if (!lease || (owner && lease.owner !== owner)) return;
  const keys = [...lease.keys]; lease = null; await native.call('release', { keys }).catch(() => {}); emit();
}
async function input(id, event, owner = 'local', leaseToken) {
  if (owner !== 'local' && (!leaseToken || lease?.token !== leaseToken)) throw new Error('This remote-control session is no longer active.');
  if (!lease || lease.owner !== owner || lease.accountId !== id || Date.now() > lease.until) { await releaseControl(owner); throw new Error('Take control before sending input.'); }
  event = inputEvent(event);
  lease.until = Date.now() + 10000;
  if (event.type === 'heartbeat') return true;
  if (event.type.startsWith('key')) { if (!Number.isInteger(event.key) || event.key < 8 || event.key > 222 || [91, 92, 93].includes(event.key)) throw new Error('Unsupported key.'); if (event.type === 'keydown') lease.keys.add(event.key); else lease.keys.delete(event.key); }
  try { return await native.call('input', { window: get(id).window, event }); } catch (e) { await releaseControl(owner); throw e; }
}
async function configureHost() {
  if (server) { const old = server; server = null; await new Promise(resolve => { old.close(resolve); old.closeAllConnections(); }); }
  await streams?.close(); await releaseControl(); hostError = '';
  if (!store.state.settings.hostEnabled) return;
  store.secrets.host ||= { ...(await certificate()), token: randomBytes(32).toString('hex') }; await persist();
  try { server = await startHost({ identity: store.secrets.host, token: store.secrets.host.token, port: store.state.settings.hostPort, bind: store.state.settings.hostBind,
    route: async (method, path, body, owner) => {
      if (method === 'GET' && path === '/state') { const s = snapshot(true); return { machine: s.machines[0], accounts: s.accounts, queue: s.queue }; }
      if (method !== 'POST' || path !== '/command') throw new Error('Unknown host route.');
      if (body.action === 'launch') { await enqueue(body.ids); return { ok: true }; }
      if (body.action === 'stop') { if (!Array.isArray(body.ids) || body.ids.length > 5000) throw new Error('Invalid selection.'); await stopAccounts(body.ids); return { ok: true }; }
      if (body.action === 'frame') return capture(body.id);
      if (body.action === 'stream.start') return streams.start(identifier(body.id), owner, body.options);
      if (body.action === 'stream.answer') return streams.answer(identifier(body.streamId), owner, body.answer);
      if (body.action === 'stream.ping') return streams.ping(identifier(body.streamId), owner);
      if (body.action === 'stream.stop') { await streams.stop(identifier(body.streamId), owner); return true; }
      if (body.action === 'audio') return setAudio(body.ids, body.audio);
      if (body.action.startsWith('layouts.')) return layoutAction(body.action, body);
      if (body.action === 'control') return takeControl(body.id, owner);
      if (body.action === 'release') { if (lease && (lease.owner !== owner || lease.token !== body.leaseToken)) throw new Error('This control lease belongs to another session.'); await releaseControl(owner); return { ok: true }; }
      if (body.action === 'input') { await input(body.id, body.event, owner, body.leaseToken); return { ok: true }; }
      throw new Error('Unsupported host command.');
    } });
  } catch (e) { hostError = `Cannot start host: ${e.message}`; throw new Error(hostError); } finally { emit(); }
}
async function remote(id, action, body = {}) {
  const [peerId, accountId] = id.split(':');
  if (!['stop', 'release', 'stream.stop', 'layouts.restore'].includes(action)) requireRemote(license.status(), store.state.peers.findIndex(p => p.id === peerId)); const p = store.state.peers.find(p => p.id === peerId); if (!p) throw new Error('Paired machine not found.');
  const result = await peerRequest(p, store.secrets.peers[p.id], '/command', { ...body, action, id: accountId, ids: body.ids || [accountId], ...(['input', 'release'].includes(action) ? { leaseToken: remoteLeases.get(id) } : {}) });
  if (action === 'control') { if (!/^[a-f0-9]{64}$/.test(result.leaseToken)) throw new Error('Invalid control lease from host.'); remoteLeases.set(id, result.leaseToken); return result; }
  if (action === 'release') remoteLeases.delete(id);
  return result;
}
function displays() {
  return screen.getAllDisplays().map(d => ({ id: String(d.id), name: d.label || `Display ${d.id}`, primary: d.id === screen.getPrimaryDisplay().id, scaleFactor: d.scaleFactor, bounds: d.bounds, workArea: d.workArea, physical: screen.dipToScreenRect(null, d.bounds) }));
}
async function layoutAction(name, arg) {
  if (name === 'layouts.state') return { displays: displays(), layouts: store.state.layouts || [], expanded: [...expandedWindows] };
  if (name === 'layouts.save') {
    const value = validateLayout(arg.layout, store.state.accounts); store.state.layouts ||= [];
    if (value.autoApply) for (const l of store.state.layouts) l.autoApply = false;
    const i = store.state.layouts.findIndex(l => l.id === value.id);
    if (i < 0) { if (store.state.layouts.length >= 50) throw new Error('Keep up to 50 layouts.'); store.state.layouts.push(value); } else store.state.layouts[i] = value;
    await persist(); emit(); return value;
  }
  if (name === 'layouts.remove') { store.state.layouts = (store.state.layouts || []).filter(l => l.id !== identifier(arg.layoutId)); await persist(); return true; }
  if (name === 'layouts.restore') {
    const results = [];
    for (const a of store.state.accounts.filter(a => a.window)) { try { await native.call('layout.restore', { window: a.window }); expandedWindows.delete(a.id); results.push({ id: a.id, ok: true }); } catch (e) { results.push({ id: a.id, ok: false, error: e.message }); } }
    return results;
  }
  if (name === 'layouts.expand') {
    const a = get(arg.accountId); if (!a.window) throw new Error('Launch or attach this window first.');
    const d = displays().find(d => d.id === String(arg.displayId)); if (!d) throw new Error('Choose an available monitor.');
    const result = await native.call('layout.expand', { window: a.window, bounds: d.physical });
    result.expanded ? expandedWindows.add(a.id) : expandedWindows.delete(a.id); return result;
  }
  if (name === 'layouts.apply') {
    const l = (store.state.layouts || []).find(l => l.id === identifier(arg.layoutId)); if (!l) throw new Error('Save this layout first.');
    const results = [];
    for (const slot of l.slots) {
      if (arg.onlyAccountId && slot.accountId !== arg.onlyAccountId) continue;
      const a = get(slot.accountId);
      if (!a.window) { results.push({ id: a.id, ok: false, error: 'Not running; placement will apply when this account launches if automatic placement is enabled.' }); continue; }
      try {
        const dip = slotBounds(slot, displays().find(d => d.id === slot.displayId), l.gap), bounds = screen.dipToScreenRect(null, dip);
        const geometry = await native.call('layout.place', { window: a.window, bounds, compact: l.compact }); expandedWindows.delete(a.id);
        results.push({ id: a.id, ok: true, warning: geometry.outer.width > bounds.width + 8 || geometry.outer.height > bounds.height + 8 ? 'The game enforced a larger minimum size.' : '', geometry });
      } catch (e) { results.push({ id: a.id, ok: false, error: e.message }); }
    }
    return results;
  }
  throw new Error('Unsupported layout command.');
}
async function applyAutomaticLayout(id) {
  const l = store.state.layouts?.find(l => l.autoApply && l.slots.some(s => s.accountId === id));
  if (l) { const results = await layoutAction('layouts.apply', { layoutId: l.id, onlyAccountId: id }); for (const r of results) if (!r.ok || r.warning) log(`Window layout: ${r.error || r.warning}`, 'warning', id); }
}
async function setAudio(ids, raw) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || !raw || !Number.isFinite(raw.volume) || raw.volume < 0 || raw.volume > 1 || typeof raw.muted !== 'boolean') throw new Error('Choose accounts and a volume between 0 and 100%.');
  const accounts = [...new Set(ids)].map(get), audio = { volume: raw.volume, muted: raw.muted }, results = [];
  for (const a of accounts) {
    a.audio = audio; audioApplied.delete(a.id);
    if (!a.window) { results.push({ id: a.id, ok: true, pending: true }); continue; }
    try { const r = await native.call('audio', { window: a.window, ...audio }); if (r.sessions) audioApplied.set(a.id, `${a.window.started}:${JSON.stringify(audio)}`); results.push({ id: a.id, ok: true, pending: !r.sessions }); }
    catch (e) { results.push({ id: a.id, ok: false, error: e.message }); }
  }
  await persist(); emit(); return results;
}

async function action(name, arg = {}, sourceWindow = win) {
  switch (name) {
    case 'state': return snapshot();
    case 'layouts.state': case 'layouts.save': case 'layouts.remove': case 'layouts.apply': case 'layouts.restore': case 'layouts.expand': {
      if (arg.machineId && arg.machineId !== 'local') {
        const peerId = identifier(arg.machineId); if (name !== 'layouts.restore') requireRemote(license.status(), store.state.peers.findIndex(p => p.id === peerId));
        return remote(`${peerId}:layout`, name, arg);
      }
      return layoutAction(name, arg);
    }
    case 'audio.set': {
      if (!Array.isArray(arg.ids) || !arg.ids.length || arg.ids.length > 5000 || arg.ids.some(id => typeof id !== 'string')) throw new Error('Choose accounts first.');
      requireBulk(license.status(), arg.ids);
      const results = [], local = arg.ids.filter(id => !id.includes(':')), groups = new Map();
      if (local.length) results.push(...await setAudio(local, arg.audio));
      for (const id of arg.ids.filter(id => id.includes(':'))) { const [peer, a] = id.split(':'); identifier(peer); identifier(a); groups.set(peer, [...(groups.get(peer) || []), a]); }
      for (const [peer, ids] of groups) { try { const r = await remote(`${peer}:${ids[0]}`, 'audio', { ids, audio: arg.audio }); results.push(...r.map(v => ({ ...v, id: `${peer}:${v.id}` }))); } catch (e) { results.push(...ids.map(id => ({ id: `${peer}:${id}`, ok: false, error: e.message }))); } }
      return results;
    }
    case 'stream.start': return arg.id.includes(':') ? remote(arg.id, 'stream.start', { options: streamOptions(arg.options) }) : streams.start(identifier(arg.id), 'local-view', arg.options);
    case 'stream.answer': case 'stream.ping': case 'stream.stop': {
      if (arg.id.includes(':')) return remote(arg.id, name, { streamId: identifier(arg.streamId), answer: arg.answer });
      if (name === 'stream.answer') return streams.answer(identifier(arg.streamId), 'local-view', arg.answer);
      if (name === 'stream.ping') return streams.ping(identifier(arg.streamId), 'local-view');
      await streams.stop(identifier(arg.streamId), 'local-view'); return true;
    }
    case 'play.focus': if (localPlay.current !== identifier(arg.id)) throw new Error('No local play session.'); return native.call('dock.focus');
    case 'license.configure': await license.configure(arg); emit(); return license.status();
    case 'license.activate': await license.activate(text(arg.key, 100)); emit(); return license.status();
    case 'license.refresh': await license.loadCatalog(); await license.refresh(); emit(); return license.status();
    case 'license.trial': await license.trial(); emit(); return license.status();
    case 'license.devices': return license.devices();
    case 'license.deactivate': await license.deactivate(identifier(arg.deviceId)); emit(); return true;
    case 'license.forget': await license.forget(); emit(); return true;
    case 'license.checkout': { const url = await license.checkout(text(arg.offer, 40)); await shell.openExternal(url); emit(); return true; }
    case 'license.purchase.cancel': { const result = await license.cancelPurchase(); emit(); return result; }
    case 'license.purchase': { const result = await license.collectPurchase(); emit(); return result; }
    case 'license.billing': await shell.openExternal(await license.billingPortal()); return true;
    case 'updates.check': return updates.check();
    case 'updates.start': return updates.start();
    case 'updates.defer': return updates.defer();
    case 'updates.install': return updates.start();
    case 'updates.configure': {
      const next = validateSettings(arg, store.state.settings); if (next.updateChannel !== store.state.settings.updateChannel) updates.setChannel(next.updateChannel);
      store.state.settings.autoUpdate = next.autoUpdate; store.state.settings.updateChannel = next.updateChannel; await persist(); emit(); return true;
    }
    case 'workflows.save': { requireFeature(license.status(), 'workflows'); const workflow = validateWorkflow(arg, store.state.accounts); store.state.workflows ||= []; const index = store.state.workflows.findIndex(w => w.id === workflow.id); if (index < 0) { if (store.state.workflows.length >= 100) throw new Error('Keep up to 100 saved workflows.'); store.state.workflows.push(workflow); } else store.state.workflows[index] = workflow; await persist(); emit(); return true; }
    case 'workflows.remove': store.state.workflows = (store.state.workflows || []).filter(w => w.id !== identifier(arg.id)); await persist(); emit(); return true;
    case 'workflows.run': { requireFeature(license.status(), 'workflows'); const workflow = (store.state.workflows || []).find(w => w.id === arg.id); if (!workflow) throw new Error('Workflow not found.'); await (workflow.action === 'launch' ? enqueue(workflow.accountIds) : stopAccounts(workflow.accountIds)); return true; }
    case 'activity.export': { requireFeature(license.status(), 'extendedHistory'); const r = await dialog.showSaveDialog(win, { defaultPath: 'orbit-activity.json', filters: [{ name: 'JSON history', extensions: ['json'] }] }); if (!r.canceled) await writeFile(r.filePath, JSON.stringify(store.state.activity, null, 2)); return !r.canceled; }
    case 'browser.start': {
      if (!encryptionReady()) throw new Error('Secure OS encryption is unavailable.');
      for (const [id, pending] of browserLogins) if (pending.closed) browserLogins.delete(id);
      if (browserLogins.size) throw new Error('Finish the open browser sign-in first.');
      const group = text(arg.group || store.state.groups[0] || 'Main', 80), id = randomUUID();
      if (!store.state.groups.includes(group)) throw new Error('Group not found.');
      const pending = await browserLogin({ connected: async cookie => { const result = await operations.connect(cookie, group); log('Browser sign-in imported.'); await persist(); return result; }, changed: () => emit() });
      browserLogins.set(id, pending); return { id };
    }
    case 'browser.status': { const pending = browserLogins.get(identifier(arg.id)); if (!pending || pending.closed) { browserLogins.delete(arg.id); return { closed: true, imported: Boolean(pending?.outcome), accountId: pending?.outcome?.id || null }; } return { closed: false, error: pending.error }; }
    case 'browser.cancel': { const pending = browserLogins.get(identifier(arg.id)); await pending?.close(); browserLogins.delete(arg.id); return true; }
    case 'sessions.files': {
      const r = await dialog.showOpenDialog(win, { title: 'Load session files for review', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Session text', extensions: ['txt','csv','log'] }] });
      if (r.canceled) return null; if (r.filePaths.length > 20) throw new Error('Choose up to 20 files.');
      const files = []; let total = 0; for (const path of r.filePaths) { const info = await stat(path); total += info.size; if (total > 5_000_000) throw new Error('Import up to 5 MB at a time.'); files.push(await readFile(path, 'utf8')); } return files.join('\n');
    }
    case 'sessions.import': { if (!encryptionReady()) throw new Error('Secure OS encryption is unavailable.'); const group = text(arg.group || store.state.groups[0], 80); if (!store.state.groups.includes(group)) throw new Error('Group not found.'); return operations.import(arg.sessions, group); }
    case 'accounts.health': { if (!Array.isArray(arg.ids)) throw new Error('Select local accounts.'); return operations.health([...new Set(arg.ids.map(identifier))]); }
    case 'operation.cancel': operations.cancel(); return true;
    case 'accounts.relaunch': {
      const a = get(arg.id), previous = a.window; await stopAccounts([a.id]);
      for (let i = 0; i < 50; i++) { const stillOpen = previous && (await windows()).some(w => w.hwnd === previous.hwnd && w.started === previous.started); if (!stillOpen && !queue.snapshot.active.includes(a.id)) { await enqueue([a.id]); queue.prioritize(a.id); return true; } await delay(200); }
      throw new Error('The previous session is still closing. Wait and launch this account again.');
    }
    case 'games.lookup': return gameDetails(text(arg.placeId, 24));
    case 'groups.configure': {
      const name = text(arg.name, 80); if (!store.state.groups.includes(name)) throw new Error('Group not found.');
      const config = launchConfig(arg.config); if (config.profileId && !store.state.profiles.some(p => p.id === config.profileId)) throw new Error('Profile not found.');
      if (config.serverIds.some(id => !store.state.privateServers.some(s => s.id === id))) throw new Error('Server not found.');
      store.state.groupSettings ||= {}; Object.defineProperty(store.state.groupSettings, name, { value: config, enumerable: true, configurable: true, writable: true }); await persist(); emit(); return true;
    }
    case 'groups.rename': {
      const name = text(arg.name, 80), next = text(arg.next, 80); if (!next || !store.state.groups.includes(name) || store.state.groups.includes(next)) throw new Error('Choose a unique group name.');
      store.state.groups = store.state.groups.map(g => g === name ? next : g); for (const a of store.state.accounts) if (a.group === name) a.group = next;
      if (Object.hasOwn(store.state.groupSettings, name)) { Object.defineProperty(store.state.groupSettings, next, { value: store.state.groupSettings[name], enumerable: true, configurable: true, writable: true }); delete store.state.groupSettings[name]; } await persist(); emit(); return true;
    }
    case 'servers.save': {
      const { server, secret } = privateServer(arg); store.state.privateServers ||= []; const i = store.state.privateServers.findIndex(s => s.id === server.id);
      if (i < 0) { if (store.state.privateServers.length >= 500) throw new Error('Keep up to 500 private servers.'); store.state.privateServers.push(server); } else store.state.privateServers[i] = server;
      store.secrets.privateServers ||= {}; store.secrets.privateServers[server.id] = secret; await persist(); emit(); return server;
    }
    case 'servers.remove': {
      const id = identifier(arg.id); store.state.privateServers = store.state.privateServers.filter(s => s.id !== id); delete store.secrets.privateServers?.[id];
      for (const a of store.state.accounts) if (a.serverId === id) a.serverId = ''; for (const c of Object.values(store.state.groupSettings)) c.serverIds = (c.serverIds || []).filter(s => s !== id); await persist(); emit(); return true;
    }
    case 'monitor.open': await openMonitor(arg.mode); return true;
    case 'login.start': return loginStart(arg);
    case 'login.finish': return loginFinish(arg.id);
    case 'login.cancel': { logins.get(arg.id)?.login.close(); return true; }
    case 'accounts.update': { const a = get(arg.id); if ('group' in arg) { if (!store.state.groups.includes(arg.group)) throw new Error('Group not found.'); a.group = arg.group; } if ('alias' in arg) a.alias = text(arg.alias, 80); if ('autoRelaunch' in arg) { if (typeof arg.autoRelaunch !== 'boolean') throw new Error('Invalid relaunch switch.'); a.autoRelaunch = arg.autoRelaunch; if (!arg.autoRelaunch) a.relaunchAt = null; } if ('serverId' in arg) { if (arg.serverId && !store.state.privateServers.some(s => s.id === arg.serverId)) throw new Error('Private server not found.'); a.serverId = arg.serverId; } if ('notes' in arg) a.notes = text(arg.notes, 2000); if ('profileId' in arg) { if (!store.state.profiles.some(p => p.id === arg.profileId)) throw new Error('Profile not found.'); a.profileId = arg.profileId; } await persist(); emit(); return true; }
    case 'accounts.organize': { if (!Array.isArray(arg.ids) || !arg.ids.length || arg.ids.length > 5000) throw new Error('Select local accounts first.'); const accounts = arg.ids.map(get); if (!store.state.groups.includes(arg.group)) throw new Error('Group not found.'); if (arg.profileId && !store.state.profiles.some(p => p.id === arg.profileId)) throw new Error('Profile not found.'); for (const a of accounts) { a.group = arg.group; if (arg.profileId) a.profileId = arg.profileId; } await persist(); emit(); return true; }
    case 'accounts.remove': { const a = get(arg.id); if (['running', 'launching', 'awaiting-window'].includes(a.status)) throw new Error('Stop this account before removing it.'); queue.cancel([a.id]); store.state.accounts = store.state.accounts.filter(x => x.id !== a.id); for (const l of store.state.layouts || []) l.slots = l.slots.filter(slot => slot.accountId !== a.id); store.state.layouts = (store.state.layouts || []).filter(l => l.slots.length); delete store.secrets.accounts[a.id]; await persist(); emit(); return true; }
    case 'accounts.launch': case 'accounts.stop': {
      if (!Array.isArray(arg.ids) || !arg.ids.length || arg.ids.length > 5000) throw new Error('Select accounts first.');
      const local = arg.ids.filter(id => !id.includes(':')), peers = new Map();
      for (const id of arg.ids.filter(id => id.includes(':'))) { const [peer, account] = id.split(':'); identifier(peer); identifier(account); const ids = peers.get(peer) || []; ids.push(account); peers.set(peer, ids); }
      if (name === 'accounts.launch') { requireBulk(license.status(), arg.ids); for (const [peer] of peers) requireRemote(license.status(), store.state.peers.findIndex(p => p.id === peer)); }
      if (local.length) await (name === 'accounts.launch' ? enqueue(local) : stopAccounts(local));
      for (const [peer, ids] of peers) await remote(`${peer}:${ids[0]}`, name === 'accounts.launch' ? 'launch' : 'stop', { ids }); return true;
    }
    case 'accounts.stopAll': { queue.stop(); await stopAccounts(store.state.accounts.map(a => a.id)); for (const [peer, state] of peerStates) if (state.online && state.accounts.length) await remote(`${peer}:${state.accounts[0].id}`, 'stop', { ids: state.accounts.map(a => a.id) }); return true; }
    case 'groups.add': { const group = text(arg.name, 80); if (!group || store.state.groups.includes(group)) throw new Error('Choose a unique group name.'); store.state.groups.push(group); await persist(); emit(); return true; }
    case 'groups.remove': { const group = text(arg.name, 80); if (store.state.accounts.some(a => a.group === group)) throw new Error('Move accounts out of this group first.'); if (store.state.groups.length <= 1) throw new Error('Keep at least one group.'); store.state.groups = store.state.groups.filter(g => g !== group); delete store.state.groupSettings?.[group]; await persist(); emit(); return true; }
    case 'queue.pause': queue.pause(); return true;
    case 'queue.resume': if (queue.nextAt > Date.now() && queue.reason.includes('rate limit')) throw new Error('Wait for the Roblox cooldown before resuming.'); queue.resume(); return true;
    case 'settings.save': { const before = store.state.settings, next = validateSettings(arg, before); if (next.desktopAlerts && !before.desktopAlerts) requireFeature(license.status(), 'alerts'); if (next.updateChannel !== before.updateChannel) updates.setChannel(next.updateChannel); if (process.platform === 'win32' && before.multiSession !== next.multiSession) { if ((await windows()).length) throw new Error('Close all Roblox windows before changing multiple-session mode.'); await native.call(next.multiSession ? 'multi.enable' : 'multi.disable'); } store.state.settings = next; await persist(); if (['hostEnabled', 'hostPort', 'hostBind', 'allowRemoteControl'].some(k => before[k] !== store.state.settings[k])) await configureHost(); emit(); return true; }
    case 'profiles.save': { const p = validateProfile(arg); const i = store.state.profiles.findIndex(x => x.id === p.id); if (i < 0) store.state.profiles.push(p); else store.state.profiles[i] = p; await persist(); emit(); return p; }
    case 'launcher.pick': { const r = await dialog.showOpenDialog(win, { title: 'Choose Froststrap or Roblox launcher', filters: [{ name: 'Windows application', extensions: ['exe'] }], properties: ['openFile'] }); return r.canceled ? null : r.filePaths[0]; }
    case 'windows.list': return windows();
    case 'windows.attach': return attach(arg.id, arg.window);
    case 'frame': return arg.id.includes(':') ? remote(arg.id, 'frame') : capture(arg.id);
    case 'play.open': {
      const a = get(arg.id); if (!a.window) throw new Error('Attach a Roblox window first.');
      if (lease || controlPending) throw new Error('Release remote control before opening local play.');
      controlPending = true;
      try {
        const handle = sourceWindow.getNativeWindowHandle();
        const host = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
        await streams?.stopAccount(a.id);
        const result = await localPlay.open(a.id, a.window, host, arg.bounds); localPlay.hostWindowId = sourceWindow.id; emit(); return result;
      } finally { controlPending = false; }
    }
    case 'play.resize': return localPlay.resize(identifier(arg.id), arg.bounds);
    case 'play.close': await localPlay.close(identifier(arg.id)); emit(); return true;
    case 'control.take': if (arg.id.includes(':')) return remote(arg.id, 'control'); { const a = get(arg.id); if (!a.window) throw new Error('Attach a Roblox window first.'); if (!await native.call('focus', { window: a.window })) throw new Error('Windows did not allow the game to take focus. Bring Roblox forward and try again.'); return true; }
    case 'control.release': if (arg.id?.includes(':')) return remote(arg.id, 'release'); await releaseControl('local'); return true;
    case 'control.input': return arg.id.includes(':') ? remote(arg.id, 'input', { event: arg.event }) : input(arg.id, arg.event);
    case 'screenshot': { const frame = arg.id.includes(':') ? await remote(arg.id, 'frame') : await capture(arg.id); const r = await dialog.showSaveDialog(win, { defaultPath: 'orbit-screenshot.png', filters: [{ name: 'PNG image', extensions: ['png'] }] }); if (!r.canceled) await writeFile(r.filePath, Buffer.from(frame.data.split(',')[1], 'base64')); return !r.canceled; }
    case 'host.pairing': { if (!server || !store.secrets.host) throw new Error('Enable machine hosting first.'); const h = store.secrets.host; return { address: snapshot().host.address, fingerprint: fingerprint(new X509Certificate(h.cert).raw), token: h.token }; }
    case 'host.rotate': { await releaseControl(); store.secrets.host.token = randomBytes(32).toString('hex'); await persist(); await configureHost(); return true; }
    case 'machines.pair': { requireRemote(license.status(), store.state.peers.length); const name = text(arg.name, 80), address = parsePeer(arg.address).origin, cert = await pinCertificate(address, arg.fingerprint), token = text(arg.token, 200); if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid pairing token.'); const p = { id: randomUUID(), name, address, certificate: cert, fingerprint: fingerprint(new X509Certificate(cert).raw) }; const s = await peerRequest(p, token, '/state'); store.state.peers.push(p); store.secrets.peers ||= {}; store.secrets.peers[p.id] = token; peerStates.set(p.id, { ...s, online: true, lastSeen: Date.now() }); await persist(); emit(); return true; }
    case 'machines.remove': { identifier(arg.id); store.state.peers = store.state.peers.filter(p => p.id !== arg.id); delete store.secrets.peers?.[arg.id]; peerStates.delete(arg.id); await persist(); emit(); return true; }
    case 'schedules.add': { const schedule = validateSchedule(arg); if (schedule.recurrence !== 'once') requireFeature(license.status(), 'advancedSchedules'); schedule.accountIds.forEach(get); store.state.schedules.push(schedule); await persist(); emit(); return true; }
    case 'schedules.remove': { store.state.schedules = store.state.schedules.filter(s => s.id !== identifier(arg.id)); await persist(); emit(); return true; }
    case 'backup.export': { const r = await dialog.showSaveDialog(win, { defaultPath: 'orbit-backup.orbit', filters: [{ name: 'Encrypted Orbit backup', extensions: ['orbit'] }] }); if (r.canceled) return false; const secrets = { accounts: store.secrets.accounts || {}, privateServers: store.secrets.privateServers || {} }; const metadata = structuredClone(store.state); metadata.peers = []; metadata.settings.hostEnabled = false; await writeFile(r.filePath, encryptBackup({ state: metadata, secrets }, arg.passphrase), { mode: 0o600 }); log('Encrypted backup exported.'); return true; }
    case 'backup.import': { const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Encrypted Orbit backup', extensions: ['orbit'] }], properties: ['openFile'] }); if (r.canceled) return false; if ((await stat(r.filePaths[0])).size > 50_000_000) throw new Error('Backup too large.'); const data = decryptBackup(await readFile(r.filePaths[0], 'utf8'), arg.passphrase); validateState(data.state); if (!data.secrets?.accounts || typeof data.secrets.accounts !== 'object' || Object.values(data.secrets.accounts).some(v => typeof v !== 'string' || v.length > 20000 || /[\r\n;]/.test(v))) throw new Error('Invalid vault backup.'); for (const a of data.state.accounts) { if (store.state.accounts.some(x => x.userId === a.userId || x.id === a.id)) continue; a.status = 'idle'; delete a.window; delete a.startedAt; store.state.accounts.push(a); store.secrets.accounts ||= {}; store.secrets.accounts[a.id] = data.secrets.accounts[a.id]; } for (const g of data.state.groups) if (!store.state.groups.includes(g)) store.state.groups.push(g); for (const server of data.state.privateServers || []) if (!store.state.privateServers.some(s => s.id === server.id)) { const secret = data.secrets.privateServers?.[server.id]; if (secret) { privateServer({ ...server, target: secret.url || secret.accessCode }); store.state.privateServers.push(server); store.secrets.privateServers ||= {}; store.secrets.privateServers[server.id] = secret; } } for (const [group, config] of Object.entries(data.state.groupSettings || {})) if (!Object.hasOwn(store.state.groupSettings, group)) Object.defineProperty(store.state.groupSettings, group, { value: launchConfig(config), enumerable: true, configurable: true, writable: true }); for (const p of data.state.profiles) if (!store.state.profiles.some(x => x.id === p.id)) store.state.profiles.push(p); for (const l of data.state.layouts || []) { const slots = l.slots?.filter(slot => store.state.accounts.some(a => a.id === slot.accountId)); if (slots?.length && !(store.state.layouts || []).some(saved => saved.id === l.id)) { const value = validateLayout({ ...l, slots, autoApply: false }, store.state.accounts); store.state.layouts ||= []; if (store.state.layouts.length < 50) store.state.layouts.push(value); } } await persist(); log('Backup merged. Existing accounts were kept.'); return true; }
    case 'window.minimize': sourceWindow.minimize(); return true;
    case 'window.maximize': sourceWindow.isMaximized() ? sourceWindow.unmaximize() : sourceWindow.maximize(); return true;
    case 'window.close': sourceWindow.close(); return true;
    case 'clipboard.copy': clipboard.writeText(text(arg.value, 4000)); return true;
    case 'link.open': { const links = { froststrap: 'https://github.com/Froststrap/Froststrap', reference: 'https://github.com/ic3w0lf22/Roblox-Account-Manager', help: 'https://github.com/ACABadAngel/Orbit-Roblox-Account-Manager' }; if (!links[arg.id]) throw new Error('Unknown link.'); await shell.openExternal(links[arg.id]); return true; }
    default: throw new Error('Unsupported Orbit action.');
  }
}

function followLocalPlayer(window) {
  let timer;
  const follow = () => { clearTimeout(timer); timer = setTimeout(() => { if (localPlay.current && localPlay.hostWindowId === window.id && localPlay.bounds) localPlay.resize(localPlay.current, localPlay.bounds).catch(() => {}); }, 16); };
  window.on('move', follow); window.on('resize', follow); window.on('restore', follow);
  window.on('closed', () => clearTimeout(timer));
}

function monitorSnapshot() {
  return { accounts: store.state.accounts.map(a => ({ id: a.id, name: a.alias || a.displayName || a.username, username: a.username, status: a.status, health: a.health || 'unknown', relaunchAt: a.relaunchAt || null, metrics: publicAccount(a).metrics })), at: Date.now() };
}
function positionMonitor(window, corner) {
  if (!['top-left','top-right','bottom-left','bottom-right'].includes(corner)) throw new Error('Choose a monitor corner.');
  const display = screen.getDisplayMatching(win.getBounds()).workArea, size = window.getBounds();
  window.setPosition(corner.endsWith('right') ? display.x + display.width - size.width - 16 : display.x + 16, corner.startsWith('bottom') ? display.y + display.height - size.height - 16 : display.y + 16);
}
async function openMonitor(mode) {
  if (!['overlay','popout'].includes(mode)) throw new Error('Choose a monitor mode.');
  await localPlay.close(); await releaseControl();
  if (mode === 'overlay') {
    if (overlay && !overlay.isDestroyed()) { overlay.show(); overlay.focus(); return; }
    overlay = new BrowserWindow({ width: 390, height: 470, minWidth: 340, minHeight: 260, title: 'Orbit · Performance', alwaysOnTop: true, autoHideMenuBar: true, backgroundColor: '#0c0d10', webPreferences: { preload: join(here, 'monitor-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); overlay.webContents.on('will-navigate', e => e.preventDefault());
    overlay.on('closed', () => { overlay = null; if (!quitting) { if (popout && !popout.isDestroyed()) popout.show(); else win?.show(); } });
    await overlay.loadFile(join(here, 'renderer', 'monitor.html')); positionMonitor(overlay, 'top-right'); win.hide(); popout?.hide();
  } else {
    overlay?.close();
    if (popout && !popout.isDestroyed()) { popout.show(); popout.focus(); return; }
    popout = new BrowserWindow({ width: 1340, height: 850, minWidth: 1050, minHeight: 700, frame: false, title: 'Orbit · Account manager', backgroundColor: '#0c0d10', webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    popout.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); popout.webContents.on('will-navigate', e => e.preventDefault());
    popout.on('close', event => { if (localPlay.current || localPlay.pending) { event.preventDefault(); localPlay.close().then(() => popout?.close()).catch(() => {}); } });
    popout.on('closed', () => { popout = null; if (!quitting) { win?.show(); win?.focus(); } });
    popout.webContents.setWebRTCIPHandlingPolicy('default');
    followLocalPlayer(popout);
    await popout.loadFile(ui, { hash: 'popout' }); win.hide();
  }
}

async function poll() {
  if (pollsBusy || !store || quitting) return; pollsBusy = true;
  try {
    const cpus = os.cpus(); let idle = 0, total = 0;
    cpus.forEach((c, i) => { const old = previousCpu[i]; if (!old) return; for (const k of Object.keys(c.times)) total += c.times[k] - old.times[k]; idle += c.times.idle - old.times.idle; }); previousCpu = cpus;
    localMetrics.cpu = total ? Math.round((1 - idle / total) * 100) : 0; localMetrics.ram = Math.round((1 - os.freemem() / os.totalmem()) * 100);
    if (process.platform === 'win32' && store.state.accounts.some(a => a.window)) { const list = await windows(); for (const a of store.state.accounts) if (a.window) { if (!list.some(w => w.hwnd === a.window.hwnd && w.pid === a.window.pid && w.started === a.window.started)) { if (lease?.accountId === a.id) await releaseControl(); await streams?.stopAccount(a.id); await localPlay.close(a.id); expandedWindows.delete(a.id); a.status = 'disconnected'; delete a.window; frames.delete(a.id); delete a.metrics; scheduleRecovery(a, effectiveConfig(store.state, a)); log(`${a.username} disconnected.${a.relaunchAt ? ' Automatic relaunch scheduled.' : ''}`, 'warning', a.id); await persist(); } else { a.lastSeen = Date.now(); const current = list.find(w => w.hwnd === a.window.hwnd && w.pid === a.window.pid && w.started === a.window.started); a.metrics = Number.isFinite(current.memoryBytes) && Number.isFinite(current.totalCpuMs) ? processMetrics(current, a.metrics, Date.now(), os.availableParallelism()) : null; const limit = effectiveConfig(store.state, a).memoryWarningMb; if (limit && a.metrics && a.metrics.memoryBytes > limit * 1048576 && !a.memoryWarned) { a.memoryWarned = true; log(`${a.username} exceeded its ${limit} MB memory warning.`, 'warning', a.id); } if (!limit || !a.metrics || a.metrics.memoryBytes < limit * 1048576 * .9) a.memoryWarned = false; }  } }
    for (const a of store.state.accounts.filter(a => a.window && a.audio)) {
      const signature = `${a.window.started}:${JSON.stringify(a.audio)}`;
      if (audioApplied.get(a.id) === signature) continue;
      try { const result = await native.call('audio', { window: a.window, ...a.audio }); if (result.sessions) audioApplied.set(a.id, signature); } catch {}
    }
    for (const a of store.state.accounts) if (a.relaunchAt && a.relaunchAt <= Date.now() && !queue.snapshot.paused) { if (!effectiveConfig(store.state, a).autoRelaunch || a.autoRelaunch === false) { a.relaunchAt = null; continue; } a.relaunchAt = null; a.recoveryAttempts ||= []; a.recoveryAttempts.push(Date.now()); await enqueue([a.id], true); }
    if (lease && lease.until < Date.now()) await releaseControl();
    await Promise.allSettled(store.state.peers.map(async p => { try { const data = await peerRequest(p, store.secrets.peers[p.id], '/state'); peerStates.set(p.id, { ...data, online: true, lastSeen: Date.now() }); } catch (e) { peerStates.set(p.id, { ...peerStates.get(p.id), online: false, error: e.message }); } }));
    for (const s of store.state.schedules.filter(s => s.status === 'pending' && s.at <= Date.now())) {
      s.status = 'running'; await persist();
      try {
        if (s.recurrence && s.recurrence !== 'once') requireFeature(license.status(), 'advancedSchedules');
        if (Date.now() - s.at > 5 * 60000) throw new Error('Missed while Orbit was closed.');
        await (s.action === 'launch' ? enqueue(s.accountIds) : stopAccounts(s.accountIds)); s.status = 'done'; s.error = ''; log(`Schedule completed: ${s.name}.`);
      } catch (e) { s.status = 'failed'; s.error = e.message; log(`Schedule ${s.name}: ${e.message}`, 'warning'); }
      const next = nextScheduleAt(s.at, s.recurrence); if (next && license.status().features.advancedSchedules) { s.lastAt = s.at; s.at = next; s.status = 'pending'; }
      await persist();
    }
    emit();
  } finally { pollsBusy = false; }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { win?.show(); win?.restore(); win?.focus(); });
  app.whenReady().then(async () => {
  try {
    store = await new Store(join(app.getPath('userData'), 'orbit-data'), {
      encrypt: async value => { if (!encryptionReady()) throw new Error('Secure OS encryption is unavailable.'); return safeStorage.encryptString(value); },
      decrypt: async value => { if (!encryptionReady()) throw new Error('Secure OS encryption is unavailable.'); return safeStorage.decryptString(value); }
    }).load();
    for (const [name, config] of Object.entries(store.state.groupSettings)) Object.defineProperty(store.state.groupSettings, name, { value: launchConfig(config), enumerable: true, configurable: true, writable: true });
    const serviceConfig = JSON.parse(await readFile(join(here, 'config', 'services.json'), 'utf8'));
    license = new LicenseClient({ store, config: serviceConfig }); await persist();
    updates = new UpdateManager({ updater: electronUpdater.autoUpdater, available: app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE, version: app.getVersion(), settings: () => store.state.settings, changed: emit,
      canInstall: async () => { if ((await windows()).length || queue?.snapshot.active.length || queue?.snapshot.pending.length || localPlay.current || lease || logins.size || [...browserLogins.values()].some(p => !p.closed) || operations?.busy) throw new Error('Close Roblox sessions and sign-in windows, and clear the launch queue before restarting to update.'); },
      prepareInstall: async () => { await persist(); }
    });
    if (process.platform === 'win32' && store.state.settings.multiSession) await native.call('multi.enable').catch(e => log(e.message, 'warning'));
    queue = new LaunchQueue({ launch, change: emit, settings: () => store.state.settings, delayFor: id => effectiveConfig(store.state, get(id)).launchDelayMs });
    operations = new AccountOperations({ store, save: persist, changed: emit, log, pause: e => { queue.nextAt = Math.max(queue.nextAt, Date.now() + (e.retryAfterMs || 60000)); queue.pause(e.message); } });
    win = new BrowserWindow({ width: 1560, height: 960, minWidth: 1050, minHeight: 700, frame: false, backgroundColor: '#0c0d10', title: 'Orbit', icon: join(here, 'renderer', 'assets', 'orbit.png'), webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    streams = new StreamHosts({ source: async id => ({ source: await sourceFor(id, { width: 0, height: 0 }), geometry: await native.call('geometry', { window: get(id).window }) }), geometry: id => native.call('geometry', { window: get(id).window }), input, release: async (id, owner) => { if (lease?.accountId === id && lease.owner === owner) await releaseControl(owner); } });
    globalShortcut.register('CommandOrControl+Shift+Backspace', () => {
      (async () => { await localPlay.close(); for (const id of [...expandedWindows]) { const a = get(id); if (a.window) await native.call('layout.expand', { window: a.window }); expandedWindows.delete(id); } win?.show(); win?.focus(); emit(); })().catch(e => log(e.message, 'warning'));
    });
    win.webContents.setWebRTCIPHandlingPolicy('default');
    followLocalPlayer(win);
    const expected = pathToFileURL(ui).href;
    ipcMain.handle('orbit:action', async (event, name, arg) => { if (![win, popout].some(w => w && !w.isDestroyed() && event.sender === w.webContents) || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split('#')[0] !== expected) throw new Error('Untrusted Orbit request.'); try { return { ok: true, value: await action(name, arg, event.sender.getOwnerBrowserWindow()) }; } catch (e) { return { ok: false, error: e.message?.slice(0, 300) || 'The action could not be completed.' }; } });
    ipcMain.handle('orbit:monitor', async (event, name, arg) => { if (![overlay, popout].some(w => w && !w.isDestroyed() && event.sender === w.webContents) || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split('#')[0] !== pathToFileURL(join(here, 'renderer', 'monitor.html')).href) throw new Error('Untrusted monitor request.'); try { if (name === 'state') return { ok: true, value: monitorSnapshot() }; if (name === 'monitor.restore') { win.show(); win.focus(); overlay?.close(); popout?.close(); return { ok: true }; } if (name === 'monitor.corner') { positionMonitor(event.sender.getOwnerBrowserWindow(), arg.corner); return { ok: true }; } throw new Error('Unsupported monitor action.'); } catch (e) { return { ok: false, error: e.message }; } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => callback(permission === 'pointerLock' && [win, popout].some(w => w && !w.isDestroyed() && w.webContents === wc) && wc.getURL().split('#')[0] === expected));
    await win.loadFile(ui);
    win.on('close', event => { if (!localPlay.current && !localPlay.pending) return; event.preventDefault(); localPlay.close().then(() => win?.close()).catch(e => dialog.showErrorBox('Close local play first', e.message)); });
    win.on('closed', () => { releaseControl().catch(() => {}); win = null; app.quit(); });
    if (store.state.settings.hostEnabled) await configureHost().catch(e => { hostError = e.message; });
    license.loadCatalog().then(() => license.refresh()).then(emit).catch(() => {});
    setInterval(() => { if (Date.now() < license.lastCheck - 5000 || Date.now() - license.lastCheck >= license.refreshInterval) license.refresh().then(emit).catch(() => {}); }, 30000).unref();
    if (store.state.settings.autoUpdate) setTimeout(() => { if (updates.available) updates.check().catch(() => {}); }, 1500).unref();
    setInterval(() => { if (updates.available && store.state.settings.autoUpdate) updates.check().catch(() => {}); }, 6 * 3600000).unref();
    setInterval(() => poll().catch(() => {}), 3000).unref(); poll().catch(() => {});
  } catch (e) { dialog.showErrorBox('Orbit could not start', e.message); app.quit(); }
  });
}
app.on('before-quit', event => {
  if (quitting || !store) return; event.preventDefault(); quitting = true; operations?.cancel(); const browserCleanup = Promise.allSettled([...browserLogins.values()].map(p => p.close()));
  queue?.stop(); for (const { login } of logins.values()) login.close();
  localPlay.close().catch(() => {}).then(() => streams?.close()).then(() => releaseControl()).finally(async () => { server?.closeAllConnections(); server?.close(); await browserCleanup; await native.close(); await persist().catch(() => {}); app.quit(); });
});
