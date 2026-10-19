export class RobloxError extends Error {
  constructor(message, status, pauseQueue = false, retryAfterMs = 0) { super(message); this.status = status; this.pauseQueue = pauseQueue; this.retryAfterMs = retryAfterMs; }
}
export function checkResponse(response) {
  if (response.headers.has('rblx-challenge-id')) throw new RobloxError('Verification required. Open the account login to continue.', 'verification', true);
  if (response.status === 429) {
    const raw = response.headers.get('retry-after'), seconds = Number(raw);
    const wait = raw ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now()) : 60000;
    throw new RobloxError('Roblox rate limit reached. Launch queue paused.', 'error', true, Math.max(60000, Number.isFinite(wait) ? wait : 60000));
  }
  if (response.status === 401) throw new RobloxError('Sign in again to refresh this account.', 'expired');
}
export async function authenticatedUser(cookie, request = fetch) {
  const r = await request('https://users.roblox.com/v1/users/authenticated', { headers: { Cookie: `.ROBLOSECURITY=${cookie}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  checkResponse(r); if (!r.ok) throw new RobloxError(`Roblox account check failed (${r.status}).`, 'error');
  const user = await r.json(); if (!Number.isSafeInteger(user.id) || !user.name) throw new Error('Invalid account response.'); return user;
}
export async function authenticationTicket(cookie, placeId, request = fetch) {
  const headers = { Cookie: `.ROBLOSECURITY=${cookie}`, Referer: `https://www.roblox.com/games/${placeId}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const url = 'https://auth.roblox.com/v1/authentication-ticket/';
  let r = await request(url, { method: 'POST', headers, body: '{}', redirect: 'error', signal: AbortSignal.timeout(15000) });
  checkResponse(r);
  if (r.status === 403 && r.headers.has('x-csrf-token')) {
    r = await request(url, { method: 'POST', headers: { ...headers, 'X-CSRF-TOKEN': r.headers.get('x-csrf-token') }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(15000) }); checkResponse(r);
  }
  const ticket = r.headers.get('rbx-authentication-ticket');
  if (r.status === 415) throw new RobloxError('Roblox rejected the launch request format (415). Update Orbit and try again.', 'error');
  if (r.status === 403) throw new RobloxError('Roblox denied the launch ticket (403). Open Roblox sign-in to review this account.', 'verification', true);
  if (!r.ok) throw new RobloxError(`Roblox could not issue a launch ticket (${r.status}). Try again later.`, 'error');
  if (!ticket) throw new RobloxError('Roblox responded without a launch ticket. Try again later.', 'error');
  return ticket;
}
export async function avatarFor(userId) {
  try { const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`, { signal: AbortSignal.timeout(8000) }); const data = await r.json(); const url = new URL(data.data?.[0]?.imageUrl); return url.protocol === 'https:' && /(^|\.)rbxcdn\.com$/.test(url.hostname) ? url.href : ''; } catch { return ''; }
}
