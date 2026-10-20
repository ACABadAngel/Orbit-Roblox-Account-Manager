import { randomUUID } from 'node:crypto';
import { identifier, number, text } from './model.mjs';

export const LAUNCH_DEFAULTS = Object.freeze({ profileId: '', launchDelayMs: 5000, autoRelaunch: false, relaunchDelayMs: 5000, serverMode: 'none', serverIds: [], memoryWarningMb: 0 });
export function launchConfig(raw = {}, previous = LAUNCH_DEFAULTS) {
  const value = { ...previous };
  if ('profileId' in raw) value.profileId = raw.profileId ? identifier(raw.profileId) : '';
  if ('launchDelayMs' in raw) value.launchDelayMs = number(raw.launchDelayMs, 0, 120000);
  if ('relaunchDelayMs' in raw) value.relaunchDelayMs = number(raw.relaunchDelayMs, 5000, 300000);
  if ('autoRelaunch' in raw) { if (typeof raw.autoRelaunch !== 'boolean') throw new Error('Invalid relaunch switch.'); value.autoRelaunch = raw.autoRelaunch; }
  if ('memoryWarningMb' in raw) value.memoryWarningMb = number(raw.memoryWarningMb, 0, 65536);
  if ('serverMode' in raw) { if (!['none', 'round-robin', 'assigned'].includes(raw.serverMode)) throw new Error('Choose a private server mode.'); value.serverMode = raw.serverMode; }
  if ('serverIds' in raw) { if (!Array.isArray(raw.serverIds) || raw.serverIds.length > 500) throw new Error('Invalid server pool.'); value.serverIds = [...new Set(raw.serverIds.map(identifier))]; }
  return value;
}
export function effectiveConfig(state, account) {
  return launchConfig((Object.hasOwn(state.groupSettings || {}, account.group) ? state.groupSettings[account.group] : {}), { ...LAUNCH_DEFAULTS, launchDelayMs: Math.min(120000, state.settings.launchDelayMs), autoRelaunch: state.settings.autoRelaunch || false, relaunchDelayMs: state.settings.relaunchDelayMs || 5000, memoryWarningMb: state.settings.memoryWarningMb || 0 });
}
export function privateServer(raw) {
  const placeId = text(raw.placeId || '', 24), name = text(raw.name || '', 80);
  if (!name || !/^[1-9]\d{0,19}$/.test(placeId)) throw new Error('Enter a server name and numeric place ID.');
  const secret = parsePrivateTarget(raw.target, placeId);
  return { server: { id: raw.id ? identifier(raw.id) : randomUUID(), name, placeId }, secret };
}
export function parsePrivateTarget(value, placeId) {
  const target = text(value, 2048);
  if (/^[a-zA-Z0-9_-]{8,256}$/.test(target)) return { kind: 'code', accessCode: target };
  let url; try { url = new URL(target); } catch { throw new Error('Enter a Roblox private-server link or access code.'); }
  if (url.protocol !== 'https:' || !['roblox.com', 'www.roblox.com'].includes(url.hostname) || url.port || url.username || url.password) throw new Error('Use an HTTPS roblox.com private-server link.');
  const match = url.pathname.match(/^\/games\/(\d+)(?:\/|$)/), code = url.searchParams.get('privateServerLinkCode');
  if (match && code && /^[a-zA-Z0-9_-]{8,256}$/.test(code)) {
    if (match[1] !== placeId) throw new Error('The link belongs to a different place ID.');
    return { kind: 'link', url: `https://www.roblox.com/games/${placeId}?privateServerLinkCode=${code}`, linkCode: code };
  }
  if (url.pathname === '/share' && url.searchParams.get('type') === 'Server' && /^[a-zA-Z0-9_-]{8,256}$/.test(url.searchParams.get('code') || '')) return { kind: 'share', url: url.href };
  throw new Error('Use a private-server invite link, not a public game URL.');
}
export function chooseServer(config, account, servers, cursors = new Map()) {
  if (config.serverMode === 'none') return null;
  if (config.serverMode === 'assigned') {
    const server = servers.find(s => s.id === account.serverId);
    if (!server) throw new Error('Assign a private server to this account first.'); return server;
  }
  const pool = config.serverIds.map(id => servers.find(s => s.id === id)).filter(Boolean);
  if (!pool.length) throw new Error('Add at least one server to this group’s pool.');
  const key = account.group, cursor = cursors.get(key) || 0; cursors.set(key, cursor + 1); return pool[cursor % pool.length];
}
// Accept explicitly pasted tokens, name=value cookies, and CSV fields. Never
// interpret username/password pairs or echo an invalid credential in an error.
export function parseSessions(input) {
  if (typeof input !== 'string' || input.length > 5_000_000) throw new Error('Import up to 5 MB at a time.');
  const rows = input.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (rows.length > 5000) throw new Error('Import up to 5,000 lines at a time.');
  return rows.map((row, i) => {
    const explicit = row.match(/(?:^|[\s,"'])\.ROBLOSECURITY\s*=\s*([^;\s"',]+)/i);
    const fields = row.match(/"(?:[^"]|"")*"|[^,\t]+/g) || [];
    let token = explicit?.[1] || fields.map(s => s.trim().replace(/^"|"$/g, '')).find(s => s.startsWith('_|WARNING:')) || (fields.length === 1 ? fields[0].trim().replace(/^"|"$/g, '') : '');
    if (!token || token.length > 20000 || /[\r\n;\s]/.test(token) || token.length < 20) return { line: i + 1, error: 'No valid session token on this line.' };
    return { line: i + 1, token };
  });
}
export function scheduleRecovery(account, config, now = Date.now()) {
  if (!config.autoRelaunch || account.autoRelaunch === false || ['verification', 'expired'].includes(account.status)) return false;
  account.recoveryAttempts = (account.recoveryAttempts || []).filter(at => now - at < 600000);
  if (account.recoveryAttempts.length >= 3) { account.relaunchAt = null; account.error = 'Automatic relaunch paused after 3 attempts in 10 minutes. Review this account and launch manually.'; return false; }
  account.relaunchAt = now + config.relaunchDelayMs; return true;
}
export function processMetrics(window, previous, now = Date.now(), cores = 1) {
  const memoryBytes = Math.max(0, Number(window.memoryBytes) || 0), totalCpuMs = Math.max(0, Number(window.totalCpuMs) || 0);
  const elapsed = previous && previous.pid === window.pid && previous.started === window.started ? now - previous.at : 0;
  const cpu = elapsed > 0 ? Math.round(Math.max(0, Math.min(100, (totalCpuMs - previous.totalCpuMs) / elapsed / Math.max(1, cores) * 100)) * 10) / 10 : 0;
  return { pid: window.pid, started: window.started, memoryBytes, totalCpuMs, cpu, at: now };
}
