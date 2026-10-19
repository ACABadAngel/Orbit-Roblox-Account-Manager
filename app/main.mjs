import { app, BrowserWindow, ipcMain, session, safeStorage, shell, dialog, desktopCapturer, clipboard } from 'electron';
import { randomUUID, randomBytes, X509Certificate } from 'node:crypto';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Store, encryptBackup, decryptBackup } from './core/storage.mjs';
import { activity, publicAccount, text, identifier, validateSettings, validateProfile, validateSchedule, validateState, makeLaunchUri } from './core/model.mjs';
import { authenticationTicket, authenticatedUser, avatarFor } from './core/roblox.mjs';
import { LaunchQueue } from './core/queue.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalPlay } from './core/local-play.mjs';
import { NativeHost } from './core/native.mjs';
import { startHost, certificate, fingerprint, parsePeer, pinCertificate, peerRequest } from './core/remote.mjs';

const here = dirname(fileURLToPath(import.meta.url)), ui = join(here, 'renderer', 'index.html');
if (!app.isPackaged && process.env.ORBIT_TEST_DATA) app.setPath('userData', process.env.ORBIT_TEST_DATA);
let win, store, queue, server, hostError = '', quitting = false, pollsBusy = false;
const native = new NativeHost(), logins = new Map(), peerStates = new Map(), frames = new Map(), remoteLeases = new Map();
let localMetrics = { id: 'local', name: os.hostname(), online: true, cpu: 0, ram: 0, totalRam: os.totalmem(), platform: process.platform };
const localPlay = new LocalPlay(native);
let previousCpu = os.cpus(), lease = null, launchHandoff = Promise.resolve(), controlPending = false;
const get = id => { const a = store.state.accounts.find(a => a.id === identifier(id)); if (!a) throw new Error('Account not found.'); return a; };
const persist = () => store.save();
const emit = () => { if (win && !win.isDestroyed()) win.webContents.send('orbit:changed'); };
function log(message, level = 'info', id = '') { activity(store.state, message, level, id); emit(); }
function encryptionReady() { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'); }
function snapshot(localOnly = false) {
  const s = store.state;
  const remote = localOnly ? [] : [...peerStates.entries()].flatMap(([peerId, state]) => (state.accounts || []).map(a => ({ ...a, id: `${peerId}:${a.id}`, remoteId: a.id, peerId, machineId: peerId, status: state.online ? a.status : 'unknown' })));
  return { localPlayId: localOnly ? null : localPlay.current, version: s.version, accounts: [...s.accounts.map(publicAccount), ...remote], groups: s.groups, profiles: s.profiles, settings: s.settings, machines: [{ ...localMetrics, accounts: s.accounts.length, running: s.accounts.filter(a => a.status === 'running').length }, ...(localOnly ? [] : s.peers.map(p => { const r = peerStates.get(p.id); return { id: p.id, name: p.name, address: p.address, online: Boolean(r?.online), cpu: r?.machine?.cpu || 0, ram: r?.machine?.ram || 0, totalRam: r?.machine?.totalRam || 0, accounts: r?.accounts?.length || 0, running: r?.accounts?.filter(a => a.status === 'running').length || 0, lastSeen: r?.lastSeen, error: r?.error || '' }; }))], queue: queue.snapshot, schedules: s.schedules, activity: s.activity, host: { enabled: Boolean(server), error: hostError, address: `https://${s.settings.hostBind === '0.0.0.0' ? (Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address || os.hostname()) : '127.0.0.1'}:${s.settings.hostPort}` }, secureStorage: encryptionReady(), platform: process.platform };
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
    const profile = s.profiles.find(p => p.id === a.profileId) || s.profiles[0]; if (!profile?.placeId) throw new Error('Set a place ID in Settings → Launch profiles.');
    const cookie = store.secrets.accounts?.[id]; if (!cookie) throw new Error('Sign in again to connect this account.');
    a.status = 'launching'; a.error = ''; emit();
    if (s.settings.multiSession) await native.call('multi.enable').catch(e => { e.pauseQueue = true; throw e; });
    const before = await native.call('list');
    if (!s.settings.multiSession && before.length) throw new Error('A Roblox session is already open. Enable multiple sessions in Settings before launching another account.');
    const ticket = await authenticationTicket(cookie, profile.placeId);
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
        log(`${a.username} connected to a Roblox window.`, 'info', id); return;
      }
      if (added.length > 1) throw new Error('Several new Roblox windows appeared. Attach the correct window manually before launching another account.');
    }
    const error = new Error('No new Roblox window appeared. Check your launcher and attach the correct window before retrying.');
    error.pauseQueue = true; throw error;
  } catch (e) { a.status = e.status || 'error'; a.error = e.message; log(`${a.username}: ${e.message}`, 'warning', id); throw e; }
  finally { await persist(); emit(); }
}
async function enqueue(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5000) throw new Error('Select accounts first.');
  const accounts = ids.map(get); for (const a of accounts) { if (['running', 'launching', 'queued', 'awaiting-window'].includes(a.status)) continue; if (a.status === 'verification' || a.status === 'expired') continue; a.status = 'queued'; a.error = ''; }
  queue.enqueue(accounts.filter(a => a.status === 'queued').map(a => a.id)); await persist(); emit();
}
async function stopAccounts(ids) {
  queue.cancel(ids);
  for (const id of ids) { const a = get(id); await localPlay.close(id); if (lease?.accountId === id) await releaseControl(); if (a.window) await native.call('close', { window: a.window }); a.status = 'idle'; delete a.window; delete a.startedAt; frames.delete(id); log(`Stopped ${a.username}.`, 'info', id); }
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
  a.status = 'idle'; a.error = ''; a.avatar = await avatarFor(user.id);
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
  a.window = w; a.status = 'running'; a.startedAt ||= Date.now(); a.lastSeen = Date.now(); a.error = ''; await persist(); emit(); return true;
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
  const source = await sourceFor(id), frame = { data: source.thumbnail.toDataURL(), at: Date.now() };
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
  if (!event || !['mousemove', 'mousedown', 'mouseup', 'keydown', 'keyup', 'wheel', 'heartbeat'].includes(event.type)) throw new Error('Unsupported input event.');
  lease.until = Date.now() + 10000;
  if (event.type === 'heartbeat') return true;
  if (event.type.startsWith('key')) { if (!Number.isInteger(event.key) || event.key < 8 || event.key > 222 || [91, 92, 93].includes(event.key)) throw new Error('Unsupported key.'); if (event.type === 'keydown') lease.keys.add(event.key); else lease.keys.delete(event.key); }
  else if (!Number.isFinite(event.x) || !Number.isFinite(event.y) || event.x < 0 || event.x > 1 || event.y < 0 || event.y > 1 || ![undefined, 0, 2].includes(event.button) || (event.type === 'wheel' && (!Number.isFinite(event.delta) || Math.abs(event.delta) > 10000))) throw new Error('Invalid pointer event.');
  try { return await native.call('input', { window: get(id).window, event }); } catch (e) { await releaseControl(owner); throw e; }
}
async function configureHost() {
  if (server) { const old = server; server = null; await new Promise(resolve => { old.close(resolve); old.closeAllConnections(); }); }
  await releaseControl(); hostError = '';
  if (!store.state.settings.hostEnabled) return;
  store.secrets.host ||= { ...(await certificate()), token: randomBytes(32).toString('hex') }; await persist();
  try { server = await startHost({ identity: store.secrets.host, token: store.secrets.host.token, port: store.state.settings.hostPort, bind: store.state.settings.hostBind,
    route: async (method, path, body, owner) => {
      if (method === 'GET' && path === '/state') { const s = snapshot(true); return { machine: s.machines[0], accounts: s.accounts, queue: s.queue }; }
      if (method !== 'POST' || path !== '/command') throw new Error('Unknown host route.');
      if (body.action === 'launch') { await enqueue(body.ids); return { ok: true }; }
      if (body.action === 'stop') { if (!Array.isArray(body.ids) || body.ids.length > 5000) throw new Error('Invalid selection.'); await stopAccounts(body.ids); return { ok: true }; }
      if (body.action === 'frame') return capture(body.id);
      if (body.action === 'control') return takeControl(body.id, owner);
      if (body.action === 'release') { if (lease && (lease.owner !== owner || lease.token !== body.leaseToken)) throw new Error('This control lease belongs to another session.'); await releaseControl(owner); return { ok: true }; }
      if (body.action === 'input') { await input(body.id, body.event, owner, body.leaseToken); return { ok: true }; }
      throw new Error('Unsupported host command.');
    } });
  } catch (e) { hostError = `Cannot start host: ${e.message}`; throw new Error(hostError); } finally { emit(); }
}
async function remote(id, action, body = {}) {
  const [peerId, accountId] = id.split(':'); const p = store.state.peers.find(p => p.id === peerId); if (!p) throw new Error('Paired machine not found.');
  const result = await peerRequest(p, store.secrets.peers[p.id], '/command', { ...body, action, id: accountId, ids: body.ids || [accountId], ...(['input', 'release'].includes(action) ? { leaseToken: remoteLeases.get(id) } : {}) });
  if (action === 'control') { if (!/^[a-f0-9]{64}$/.test(result.leaseToken)) throw new Error('Invalid control lease from host.'); remoteLeases.set(id, result.leaseToken); return { ok: true }; }
  if (action === 'release') remoteLeases.delete(id);
  return result;
}
async function action(name, arg = {}) {
  switch (name) {
    case 'state': return snapshot();
    case 'login.start': return loginStart(arg);
    case 'login.finish': return loginFinish(arg.id);
    case 'login.cancel': { logins.get(arg.id)?.login.close(); return true; }
    case 'accounts.update': { const a = get(arg.id); if ('group' in arg) { if (!store.state.groups.includes(arg.group)) throw new Error('Group not found.'); a.group = arg.group; } if ('notes' in arg) a.notes = text(arg.notes, 2000); if ('profileId' in arg) { if (!store.state.profiles.some(p => p.id === arg.profileId)) throw new Error('Profile not found.'); a.profileId = arg.profileId; } await persist(); emit(); return true; }
    case 'accounts.organize': { if (!Array.isArray(arg.ids) || !arg.ids.length || arg.ids.length > 5000) throw new Error('Select local accounts first.'); const accounts = arg.ids.map(get); if (!store.state.groups.includes(arg.group)) throw new Error('Group not found.'); if (arg.profileId && !store.state.profiles.some(p => p.id === arg.profileId)) throw new Error('Profile not found.'); for (const a of accounts) { a.group = arg.group; if (arg.profileId) a.profileId = arg.profileId; } await persist(); emit(); return true; }
    case 'accounts.remove': { const a = get(arg.id); if (['running', 'launching', 'awaiting-window'].includes(a.status)) throw new Error('Stop this account before removing it.'); queue.cancel([a.id]); store.state.accounts = store.state.accounts.filter(x => x.id !== a.id); delete store.secrets.accounts[a.id]; await persist(); emit(); return true; }
    case 'accounts.launch': case 'accounts.stop': {
      if (!Array.isArray(arg.ids) || !arg.ids.length || arg.ids.length > 5000) throw new Error('Select accounts first.');
      const local = arg.ids.filter(id => !id.includes(':')), peers = new Map();
      for (const id of arg.ids.filter(id => id.includes(':'))) { const [peer, account] = id.split(':'); identifier(peer); identifier(account); const ids = peers.get(peer) || []; ids.push(account); peers.set(peer, ids); }
      if (local.length) await (name === 'accounts.launch' ? enqueue(local) : stopAccounts(local));
      for (const [peer, ids] of peers) await remote(`${peer}:${ids[0]}`, name === 'accounts.launch' ? 'launch' : 'stop', { ids }); return true;
    }
    case 'accounts.stopAll': { queue.stop(); await stopAccounts(store.state.accounts.map(a => a.id)); for (const [peer, state] of peerStates) if (state.online && state.accounts.length) await remote(`${peer}:${state.accounts[0].id}`, 'stop', { ids: state.accounts.map(a => a.id) }); return true; }
    case 'groups.add': { const group = text(arg.name, 80); if (!group || store.state.groups.includes(group)) throw new Error('Choose a unique group name.'); store.state.groups.push(group); await persist(); emit(); return true; }
    case 'groups.remove': { const group = text(arg.name, 80); if (store.state.accounts.some(a => a.group === group)) throw new Error('Move accounts out of this group first.'); store.state.groups = store.state.groups.filter(g => g !== group); await persist(); emit(); return true; }
    case 'queue.pause': queue.pause(); return true;
    case 'queue.resume': if (queue.nextAt > Date.now() && queue.reason.includes('rate limit')) throw new Error('Wait for the Roblox cooldown before resuming.'); queue.resume(); return true;
    case 'settings.save': { const before = store.state.settings, next = validateSettings(arg, before); if (process.platform === 'win32' && before.multiSession !== next.multiSession) { if ((await windows()).length) throw new Error('Close all Roblox windows before changing multiple-session mode.'); await native.call(next.multiSession ? 'multi.enable' : 'multi.disable'); } store.state.settings = next; await persist(); if (['hostEnabled', 'hostPort', 'hostBind', 'allowRemoteControl'].some(k => before[k] !== store.state.settings[k])) await configureHost(); emit(); return true; }
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
        const handle = win.getNativeWindowHandle();
        const host = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
        const result = await localPlay.open(a.id, a.window, host, arg.bounds); emit(); return result;
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
    case 'machines.pair': { const name = text(arg.name, 80), address = parsePeer(arg.address).origin, cert = await pinCertificate(address, arg.fingerprint), token = text(arg.token, 200); if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid pairing token.'); const p = { id: randomUUID(), name, address, certificate: cert, fingerprint: fingerprint(new X509Certificate(cert).raw) }; const s = await peerRequest(p, token, '/state'); store.state.peers.push(p); store.secrets.peers ||= {}; store.secrets.peers[p.id] = token; peerStates.set(p.id, { ...s, online: true, lastSeen: Date.now() }); await persist(); emit(); return true; }
    case 'machines.remove': { identifier(arg.id); store.state.peers = store.state.peers.filter(p => p.id !== arg.id); delete store.secrets.peers?.[arg.id]; peerStates.delete(arg.id); await persist(); emit(); return true; }
    case 'schedules.add': { const schedule = validateSchedule(arg); schedule.accountIds.forEach(get); store.state.schedules.push(schedule); await persist(); emit(); return true; }
    case 'schedules.remove': { store.state.schedules = store.state.schedules.filter(s => s.id !== identifier(arg.id)); await persist(); emit(); return true; }
    case 'backup.export': { const r = await dialog.showSaveDialog(win, { defaultPath: 'orbit-backup.orbit', filters: [{ name: 'Encrypted Orbit backup', extensions: ['orbit'] }] }); if (r.canceled) return false; const secrets = { accounts: store.secrets.accounts || {} }; const metadata = structuredClone(store.state); metadata.peers = []; metadata.settings.hostEnabled = false; await writeFile(r.filePath, encryptBackup({ state: metadata, secrets }, arg.passphrase), { mode: 0o600 }); log('Encrypted backup exported.'); return true; }
    case 'backup.import': { const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Encrypted Orbit backup', extensions: ['orbit'] }], properties: ['openFile'] }); if (r.canceled) return false; if ((await stat(r.filePaths[0])).size > 50_000_000) throw new Error('Backup too large.'); const data = decryptBackup(await readFile(r.filePaths[0], 'utf8'), arg.passphrase); validateState(data.state); if (!data.secrets?.accounts || typeof data.secrets.accounts !== 'object' || Object.values(data.secrets.accounts).some(v => typeof v !== 'string' || v.length > 20000 || /[\r\n;]/.test(v))) throw new Error('Invalid vault backup.'); for (const a of data.state.accounts) { if (store.state.accounts.some(x => x.userId === a.userId || x.id === a.id)) continue; a.status = 'idle'; delete a.window; delete a.startedAt; store.state.accounts.push(a); store.secrets.accounts ||= {}; store.secrets.accounts[a.id] = data.secrets.accounts[a.id]; } for (const g of data.state.groups) if (!store.state.groups.includes(g)) store.state.groups.push(g); for (const p of data.state.profiles) if (!store.state.profiles.some(x => x.id === p.id)) store.state.profiles.push(p); await persist(); log('Backup merged. Existing accounts were kept.'); return true; }
    case 'window.minimize': win.minimize(); return true;
    case 'window.maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); return true;
    case 'window.close': win.close(); return true;
    case 'clipboard.copy': clipboard.writeText(text(arg.value, 4000)); return true;
    case 'link.open': { const links = { froststrap: 'https://github.com/Froststrap/Froststrap', reference: 'https://github.com/ic3w0lf22/Roblox-Account-Manager', help: 'https://github.com/ACABadAngel/Orbit-Roblox-Account-Manager' }; if (!links[arg.id]) throw new Error('Unknown link.'); await shell.openExternal(links[arg.id]); return true; }
    default: throw new Error('Unsupported Orbit action.');
  }
}

async function poll() {
  if (pollsBusy || !store) return; pollsBusy = true;
  try {
    const cpus = os.cpus(); let idle = 0, total = 0;
    cpus.forEach((c, i) => { const old = previousCpu[i]; if (!old) return; for (const k of Object.keys(c.times)) total += c.times[k] - old.times[k]; idle += c.times.idle - old.times.idle; }); previousCpu = cpus;
    localMetrics.cpu = total ? Math.round((1 - idle / total) * 100) : 0; localMetrics.ram = Math.round((1 - os.freemem() / os.totalmem()) * 100);
    if (process.platform === 'win32' && store.state.accounts.some(a => a.window)) { const list = await windows(); for (const a of store.state.accounts) if (a.window) { if (!list.some(w => w.hwnd === a.window.hwnd && w.pid === a.window.pid && w.started === a.window.started)) { if (lease?.accountId === a.id) await releaseControl(); await localPlay.close(a.id); a.status = 'disconnected'; delete a.window; frames.delete(a.id); log(`${a.username} disconnected.`, 'warning', a.id); } else a.lastSeen = Date.now(); } }
    if (lease && lease.until < Date.now()) await releaseControl();
    await Promise.allSettled(store.state.peers.map(async p => { try { const data = await peerRequest(p, store.secrets.peers[p.id], '/state'); peerStates.set(p.id, { ...data, online: true, lastSeen: Date.now() }); } catch (e) { peerStates.set(p.id, { ...peerStates.get(p.id), online: false, error: e.message }); } }));
    for (const s of store.state.schedules.filter(s => s.status === 'pending' && s.at <= Date.now())) { s.status = 'running'; await persist(); try { if (Date.now() - s.at > 5 * 60000) throw new Error('Missed while Orbit was closed.'); await (s.action === 'launch' ? enqueue(s.accountIds) : stopAccounts(s.accountIds)); s.status = 'done'; log(`Schedule completed: ${s.name}.`); } catch (e) { s.status = 'failed'; s.error = e.message; log(`Schedule ${s.name}: ${e.message}`, 'warning'); } await persist(); }
    emit();
  } finally { pollsBusy = false; }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { win?.restore(); win?.focus(); });
  app.whenReady().then(async () => {
  try {
    store = await new Store(join(app.getPath('userData'), 'orbit-data'), {
      encrypt: async value => { if (!encryptionReady()) throw new Error('Secure OS encryption is unavailable.'); return safeStorage.encryptString(value); },
      decrypt: async value => { if (!encryptionReady()) throw new Error('Secure OS encryption is unavailable.'); return safeStorage.decryptString(value); }
    }).load();
    if (process.platform === 'win32' && store.state.settings.multiSession) await native.call('multi.enable').catch(e => log(e.message, 'warning'));
    queue = new LaunchQueue({ launch, change: emit, settings: () => store.state.settings });
    win = new BrowserWindow({ width: 1560, height: 960, minWidth: 1050, minHeight: 700, frame: false, backgroundColor: '#17191b', title: 'Orbit', icon: join(here, 'renderer', 'assets', 'orbit.png'), webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    const expected = pathToFileURL(ui).href;
    ipcMain.handle('orbit:action', async (event, name, arg) => { if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== expected) throw new Error('Untrusted Orbit request.'); try { return { ok: true, value: await action(name, arg) }; } catch (e) { return { ok: false, error: e.message?.slice(0, 300) || 'The action could not be completed.' }; } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_w, _p, callback) => callback(false));
    await win.loadFile(ui);
    win.on('close', event => { if (!localPlay.current) return; event.preventDefault(); localPlay.close().then(() => win?.close()).catch(e => dialog.showErrorBox('Close local play first', e.message)); });
    win.on('closed', () => { releaseControl().catch(() => {}); win = null; app.quit(); });
    if (store.state.settings.hostEnabled) await configureHost().catch(e => { hostError = e.message; });
    setInterval(() => poll().catch(() => {}), 3000).unref(); poll().catch(() => {});
  } catch (e) { dialog.showErrorBox('Orbit could not start', e.message); app.quit(); }
  });
}
app.on('before-quit', event => {
  if (quitting || !store) return; event.preventDefault(); quitting = true;
  queue?.stop(); for (const { login } of logins.values()) login.close();
  localPlay.close().catch(() => {}).then(() => releaseControl()).finally(async () => { server?.closeAllConnections(); server?.close(); await native.close(); await persist().catch(() => {}); app.quit(); });
});
