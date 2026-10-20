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

export async function gameDetails(placeId, request = fetch) {
  if (!/^[1-9]\d{0,19}$/.test(placeId)) throw new Error('Enter a numeric place ID.');
  const options = { redirect: 'error', signal: AbortSignal.timeout(15000) };
  const r = await request(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`, options); checkResponse(r);
  if (!r.ok) throw new Error(`Could not look up this place (${r.status}).`);
  const { universeId } = await r.json(); if (!Number.isSafeInteger(universeId) || universeId < 1) throw new Error('No experience found for this place.');
  const games = await request(`https://games.roblox.com/v1/games?universeIds=${universeId}`, { ...options, signal: AbortSignal.timeout(15000) }); checkResponse(games);
  if (!games.ok) throw new Error(`Could not load game information (${games.status}).`);
  const data = (await games.json()).data?.[0]; if (!data?.name) throw new Error('This game is unavailable.');
  return { placeId, universeId, name: String(data.name).slice(0, 120), creator: String(data.creator?.name || 'Unknown').slice(0, 100), playing: Math.max(0, Number(data.playing) || 0), checkedAt: Date.now() };
}
export async function resolvePrivateServer(secret, placeId, cookie, request = fetch) {
  if (secret.kind === 'code') return { accessCode: secret.accessCode };
  if (secret.resolved && Date.now() - secret.resolved.at < 3600000) return secret.resolved;
  let url = new URL(secret.url), linkCode = secret.linkCode || '';
  for (let redirects = 0; redirects < 5; redirects++) {
    if (url.protocol !== 'https:' || !['www.roblox.com','roblox.com'].includes(url.hostname) || url.port || url.username || url.password || !/^\/(games\/|share(?:\?|$)|share$)/.test(url.pathname)) throw new Error('Private-server invite did not resolve to a Roblox game.');
    const r = await request(url.href, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` }, redirect: 'manual', signal: AbortSignal.timeout(15000) }); checkResponse(r);
    if ([301,302,303,307,308].includes(r.status)) { const next = r.headers.get('location'); if (!next) break; url = new URL(next, url); continue; }
    if (!r.ok) throw new Error(`Roblox could not resolve this invite (${r.status}).`);
    const match = url.pathname.match(/^\/games\/(\d+)/); if (match && match[1] !== placeId) throw new Error('The private invite belongs to another place.');
    linkCode = url.searchParams.get('privateServerLinkCode') || linkCode;
    const html = await r.text(); if (html.length > 5_000_000) throw new Error('Private-server response was too large.');
    const accessCode = html.match(/Roblox\.GameLauncher\.joinPrivateGame\(\d+,\s*['"]([a-zA-Z0-9_-]{8,256})['"]/)?.[1] || html.match(/data-private-server-access-code=['"]([a-zA-Z0-9_-]{8,256})['"]/)?.[1];
    if (accessCode && /^[a-zA-Z0-9_-]{8,256}$/.test(linkCode)) { secret.resolved = { accessCode, linkCode, at: Date.now() }; return secret.resolved; }
    break;
  }
  throw new Error('Roblox did not resolve this invite. Use its full /games/ private-server link or access code, and check account access.');
}
