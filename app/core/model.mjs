import { randomUUID } from 'node:crypto';

export const STATUSES = ['idle', 'queued', 'launching', 'awaiting-window', 'running', 'disconnected', 'verification', 'expired', 'error'];
export const DEFAULTS = Object.freeze({ launchDelayMs: 15000, maxConcurrent: 1, launcherPath: '', theme: 'dark', previewFps: 3, hostEnabled: false, hostPort: 43128, hostBind: '127.0.0.1', allowRemoteControl: false });
export const initialState = () => ({ version: 1, accounts: [], groups: ['Main', 'Trading', 'Testing'], profiles: [{ id: 'default', name: 'Default', placeId: '', jobId: '' }], settings: { ...DEFAULTS }, peers: [], schedules: [], activity: [] });
export function text(value, max = 120) { if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text value.'); return value.trim(); }
export function identifier(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('Invalid identifier.'); return value; }
export function number(value, min, max) { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Expected a number between ${min} and ${max}.`); return value; }
export function validateProfile(value) {
  const placeId = text(value.placeId, 24), jobId = text(value.jobId || '', 64);
  if (placeId && !/^[1-9]\d{0,19}$/.test(placeId)) throw new Error('Enter a numeric Roblox place ID.');
  if (jobId && !/^[a-zA-Z0-9-]{1,64}$/.test(jobId)) throw new Error('Enter a valid server job ID.');
  return { id: value.id ? identifier(value.id) : randomUUID(), name: text(value.name || 'Default', 80), placeId, jobId };
}
export function validateSettings(input, previous = DEFAULTS) {
  const s = { ...previous };
  if ('launchDelayMs' in input) s.launchDelayMs = number(input.launchDelayMs, 5000, 3600000);
  if ('maxConcurrent' in input) s.maxConcurrent = number(input.maxConcurrent, 1, 5) | 0;
  if ('previewFps' in input) s.previewFps = number(input.previewFps, 1, 10) | 0;
  if ('launcherPath' in input) { s.launcherPath = text(input.launcherPath, 1024); if (s.launcherPath && !/^[a-zA-Z]:\\.+\.exe$/i.test(s.launcherPath)) throw new Error('Choose a Windows launcher .exe.'); }
  if ('theme' in input) { if (!['dark', 'light'].includes(input.theme)) throw new Error('Invalid theme.'); s.theme = input.theme; }
  for (const key of ['hostEnabled', 'allowRemoteControl']) if (key in input) { if (typeof input[key] !== 'boolean') throw new Error('Invalid switch.'); s[key] = input[key]; }
  if ('hostPort' in input) s.hostPort = number(input.hostPort, 1024, 65535) | 0;
  if ('hostBind' in input) { if (!['127.0.0.1', '0.0.0.0'].includes(input.hostBind)) throw new Error('Invalid listening address.'); s.hostBind = input.hostBind; }
  return s;
}
export function validateState(s) {
  if (!s || s.version !== 1 || !Array.isArray(s.accounts) || s.accounts.length > 5000 || !Array.isArray(s.groups) || !Array.isArray(s.profiles)) throw new Error('Unsupported or damaged Orbit data.');
  const ids = new Set();
  for (const a of s.accounts) { identifier(a.id); text(a.username, 40); text(a.displayName, 80); text(a.group, 80); if (!Number.isSafeInteger(a.userId) || a.userId < 1 || ids.has(a.id)) throw new Error('Invalid or duplicate account.'); ids.add(a.id); }
  s.groups.forEach(g => text(g, 80)); s.profiles = s.profiles.map(validateProfile); s.settings = validateSettings(s.settings || {});
  if (!Array.isArray(s.peers) || !Array.isArray(s.schedules) || !Array.isArray(s.activity)) throw new Error('Invalid Orbit data.');
  return s;
}
export function publicAccount(a) {
  return { id: a.id, userId: a.userId, username: a.username, displayName: a.displayName, group: a.group, profileId: a.profileId, notes: a.notes || '', avatar: a.avatar || '', status: a.status, machineId: a.machineId || 'local', startedAt: a.startedAt || null, lastSeen: a.lastSeen || null, addedAt: a.addedAt, game: a.game || '', error: a.error || '', windowAttached: Boolean(a.window), hasFrame: Boolean(a.hasFrame) };
}
export function activity(state, message, level = 'info', accountId = '') { state.activity.unshift({ id: randomUUID(), at: Date.now(), message, level, accountId }); state.activity = state.activity.slice(0, 1000); }

export function makeLaunchUri(ticket, profile, now = Date.now()) {
  if (typeof ticket !== 'string' || !/^[a-zA-Z0-9._~-]{1,8192}$/.test(ticket)) throw new Error('Invalid authentication ticket.');
  if (!profile.placeId) throw new Error('Set a place ID in the launch profile first.');
  validateProfile(profile);
  const params = new URLSearchParams({ request: profile.jobId ? 'RequestGameJob' : 'RequestGame', placeId: profile.placeId, isPlayTogetherGame: 'false' });
  if (profile.jobId) params.set('gameId', profile.jobId);
  return `roblox-player:1+launchmode:play+gameinfo:${ticket}+launchtime:${now}+placelauncherurl:${encodeURIComponent('https://assetgame.roblox.com/game/PlaceLauncher.ashx?' + params)}+robloxLocale:en_us+gameLocale:en_us+channel:`;
}

export function validateSchedule(raw) {
  if (!Array.isArray(raw.accountIds) || raw.accountIds.length < 1 || raw.accountIds.length > 5000) throw new Error('Choose accounts for this schedule.');
  const at = Number(raw.at); if (!Number.isFinite(at) || at < Date.now() + 1000) throw new Error('Choose a future date and time.');
  if (!['launch', 'stop'].includes(raw.action)) throw new Error('Invalid scheduled action.');
  return { id: randomUUID(), name: text(raw.name || 'Scheduled session', 80), accountIds: [...new Set(raw.accountIds.map(identifier))], action: raw.action, at, status: 'pending' };
}
