import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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
test('ticket requests send valid JSON over HTTP on both the initial POST and CSRF retry', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, headers: req.headers, body });
    if (req.headers['content-type'] !== 'application/json' || body !== '{}') { res.writeHead(415); res.end(); return; }
    if (req.headers['x-csrf-token'] !== 'csrf-from-server') { res.writeHead(403, { 'x-csrf-token': 'csrf-from-server' }); res.end(); return; }
    res.writeHead(200, { 'rbx-authentication-ticket': 'launch-ticket' }); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const ticket = await authenticationTicket('test-session', '123', (url, options) => {
      assert.equal(url, 'https://auth.roblox.com/v1/authentication-ticket/');
      return fetch(`http://127.0.0.1:${server.address().port}`, options);
    });
    assert.equal(ticket, 'launch-ticket'); assert.equal(requests.length, 2);
    for (const r of requests) { assert.equal(r.method, 'POST'); assert.deepEqual(JSON.parse(r.body), {}); assert.equal(r.headers.accept, 'application/json'); assert.equal(r.headers.cookie, '.ROBLOSECURITY=test-session'); }
    assert.equal(requests[0].headers['x-csrf-token'], undefined);
    assert.equal(requests[1].headers['x-csrf-token'], 'csrf-from-server');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('415 format errors do not suggest account verification or pause the queue', async () => {
  await assert.rejects(authenticationTicket('test-session', '123', async () => new Response('', { status: 415 })), err => err.status === 'error' && !err.pauseQueue && /request format/.test(err.message) && !/sign in/i.test(err.message));
});
test('a successful response missing its ticket is reported as a service error', async () => {
  await assert.rejects(authenticationTicket('test-session', '123', async () => new Response('', { status: 200 })), err => err.status === 'error' && /without a launch ticket/.test(err.message));
});
