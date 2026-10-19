import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticationTicket, authenticatedUser } from '../app/core/roblox.mjs';
test('authentication retries once with Roblox CSRF token and never follows redirects', async () => {
  let n = 0; const request = async (url, opts) => { assert.equal(url, 'https://auth.roblox.com/v1/authentication-ticket/'); assert.equal(opts.redirect, 'error'); assert.equal(opts.headers.Cookie, '.ROBLOSECURITY=secret'); if (n++ === 0) return new Response('', { status: 403, headers: { 'x-csrf-token': 'csrf' } }); assert.equal(opts.headers['X-CSRF-TOKEN'], 'csrf'); return new Response('', { status: 200, headers: { 'rbx-authentication-ticket': 'ticket' } }); };
  assert.equal(await authenticationTicket('secret', '123', request), 'ticket'); assert.equal(n, 2);
});
test('CAPTCHA challenge pauses immediately and does not retry it', async () => {
  let n = 0; await assert.rejects(authenticationTicket('secret', '123', async () => { n++; return new Response('', { status: 403, headers: { 'rblx-challenge-id': 'challenge', 'x-csrf-token': 'csrf' } }); }), err => err.pauseQueue && err.status === 'verification'); assert.equal(n, 1);
});
test('rate limits carry Retry-After into the queue cooldown', async () => {
  await assert.rejects(authenticationTicket('secret', '123', async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } })), err => err.pauseQueue && err.retryAfterMs === 120000);
});
test('expired account becomes a sign-in request and API errors do not leak response bodies', async () => {
  await assert.rejects(authenticatedUser('secret', async () => new Response('sensitive response', { status: 401 })), err => err.status === 'expired' && !err.message.includes('sensitive'));
});
