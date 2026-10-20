import test from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_DEFAULTS, launchConfig, effectiveConfig, parseSessions, privateServer, chooseServer, scheduleRecovery, processMetrics } from '../app/core/account-manager.mjs';
import { initialState, validateState, makeLaunchUri, publicAccount } from '../app/core/model.mjs';
import { AccountOperations } from '../app/core/account-operations.mjs';
import { RobloxError, gameDetails, resolvePrivateServer } from '../app/core/roblox.mjs';

const token = 'a'.repeat(100), account = () => ({ id: 'one', userId: 1, username: 'Tester', displayName: 'Test', group: 'Main', status: 'idle', autoRelaunch: true });
test('group configs preserve zero delay, override profiles and reject impossible recovery limits', () => {
  const state = initialState(), a = account(); state.groupSettings.Main = launchConfig({ profileId: 'other', launchDelayMs: 0, autoRelaunch: true, relaunchDelayMs: 300000 });
  assert.equal(effectiveConfig(state, a).launchDelayMs, 0); assert.equal(effectiveConfig(state, a).profileId, 'other');
  assert.throws(() => launchConfig({ relaunchDelayMs: 0 })); assert.throws(() => launchConfig({ serverMode: 'mystery' })); assert.throws(() => launchConfig({ serverIds: ['__proto__'] }));
  const old = initialState(); old.settings.launchDelayMs = 3600000; delete old.groupSettings; delete old.privateServers;
  assert.equal(validateState(old).settings.launchDelayMs, 120000); assert.deepEqual(old.privateServers, []);
  assert.equal(effectiveConfig(state, { ...a, group: 'constructor' }).launchDelayMs, 5000);
});
test('private invites reject credentials, foreign origins and mismatched places; selection rotates independent group pools', () => {
  const server = privateServer({ name: 'Private', placeId: '123', target: 'https://www.roblox.com/games/123/Name?privateServerLinkCode=123456789' });
  assert.equal(server.secret.linkCode, '123456789'); assert.equal('url' in server.server, false);
  for (const target of ['https://evil.test/games/123?privateServerLinkCode=123456789','https://u:p@www.roblox.com/games/123?privateServerLinkCode=123456789','https://www.roblox.com/games/456?privateServerLinkCode=123456789','https://www.roblox.com/games/123']) assert.throws(() => privateServer({ name: 'Private', placeId: '123', target }));
  const servers = [{ id: 'a' }, { id: 'b' }], config = { ...LAUNCH_DEFAULTS, serverMode: 'round-robin', serverIds: ['a','b'] }, cursor = new Map(), a = account();
  assert.equal(chooseServer(config,a,servers,cursor).id,'a'); assert.equal(chooseServer(config,a,servers,cursor).id,'b'); assert.equal(chooseServer(config,{...a,group:'Trading'},servers,cursor).id,'a');
  assert.throws(() => chooseServer({ ...config, serverMode: 'assigned' }, a, servers));
  assert.equal(chooseServer({ ...config, serverMode: 'assigned' }, { ...a, serverId: 'b' }, servers).id, 'b');
  const uri = makeLaunchUri('ticket', { id: 'p', name: 'Private', placeId: '123', accessCode: 'access-code', linkCode: 'link-code', jobId: 'abc' });
  const params = new URL(decodeURIComponent(uri.match(/placelauncherurl:([^+]+)/)[1])).searchParams;
  assert.equal(params.get('request'), 'RequestPrivateGame'); assert.equal(params.get('accessCode'), 'access-code'); assert.equal(params.has('gameId'), false);
});
test('session parser supports explicit cookies and CSV while returning only line numbers for malformed rows', () => {
  const rows = parseSessions(`${token}\n.ROBLOSECURITY=${token}; Path=/\n"username","_|WARNING:-DO-NOT-SHARE-THIS.${token}"\nbad,password`);
  assert.equal(rows[0].token, token); assert.equal(rows[1].token, token); assert.ok(rows[2].token.startsWith('_|WARNING:')); assert.deepEqual(rows[3], { line: 4, error: 'No valid session token on this line.' });
  assert.throws(() => parseSessions('x'.repeat(5_000_001)));
});
test('bulk import deduplicates identities, preserves running sessions and pauses on verification without echoing tokens', async () => {
  const store = { state: initialState(), secrets: {} }, logs = []; let saves = 0, pause = false;
  const op = new AccountOperations({ store, save: async () => saves++, avatar: async () => '', log: message => logs.push(message), pause: () => pause = true, user: async cookie => { if (cookie === 'b'.repeat(100)) throw new RobloxError('body could contain a token', 'verification', true); return { id: 1, name: 'Tester' }; } });
  let result = await op.import(`${token}\n${token}`, 'Main'); assert.equal(result.imported,1); assert.equal(result.updated,1); assert.equal(store.state.accounts.length,1); assert.equal(saves,2);
  const a = store.state.accounts[0]; a.window = { hwnd: '123' }; a.status = 'running'; await op.connect(token,'Trading'); assert.equal(a.status,'running'); assert.equal(a.group,'Main');
  result = await op.import(`${'b'.repeat(100)}\n${token}`, 'Main'); assert.equal(result.failed.length,1); assert.equal(result.skipped,1); assert.equal(pause,true);
  assert.equal(JSON.stringify(result).includes('bbbb'), false); assert.equal(logs.join('').includes(token),false); assert.equal(JSON.stringify(publicAccount(a)).includes(token),false);
});
test('health checks distinguish expired, mismatched and service-unavailable sessions and support cancellation', async () => {
  const state = initialState(); state.accounts = [account(),{...account(),id:'two',userId:2},{...account(),id:'three',userId:3}];
  const store = { state, secrets: { accounts: { one:'ok',two:'expired',three:'error' } } };
  const op = new AccountOperations({ store, save:async()=>{}, user:async cookie => { if(cookie==='expired') throw new RobloxError('expired','expired'); if(cookie==='error') throw new Error('Network failed'); return {id:99}; } });
  const result = await op.health(['one','two','three']); assert.deepEqual(result,{alive:0,dead:2,unknown:1,skipped:0});
  assert.ok(state.accounts.every(a=>a.checkedAt)); assert.equal(op.busy,false);
  op.user = async()=>{ op.cancel(); return {id:1}; }; const cancelled = await op.health(['one','two']); assert.equal(cancelled.skipped,1);
});
test('recovery stops after three attempts per ten minutes and excludes manual opt-outs and verification states', () => {
  const a = account(), config = { ...LAUNCH_DEFAULTS, autoRelaunch:true }; assert.equal(scheduleRecovery(a,config,1000),true); assert.equal(a.relaunchAt,6000);
  a.recoveryAttempts=[1000,2000,3000]; assert.equal(scheduleRecovery(a,config,5000),false); assert.equal(a.relaunchAt,null);
  assert.equal(scheduleRecovery(a,config,700000),true); assert.equal(scheduleRecovery({...a,autoRelaunch:false},config),false); assert.equal(scheduleRecovery({...a,status:'verification'},config),false);
});
test('process CPU uses deltas normalized to machine capacity, bounds values and detects PID reuse', () => {
  const previous = processMetrics({pid:42,started:'one',totalCpuMs:100,memoryBytes:500},null,1000,4);
  assert.equal(processMetrics({pid:42,started:'one',totalCpuMs:500,memoryBytes:600},previous,2000,4).cpu,10);
  assert.equal(processMetrics({pid:42,started:'two',totalCpuMs:500,memoryBytes:600},previous,2000,4).cpu,0);
});
test('private resolver rejects cross-origin redirects before sending credentials and caches only successful resolutions', async () => {
  const secret = {kind:'link',url:'https://www.roblox.com/games/123?privateServerLinkCode=123456789',linkCode:'123456789'}, calls=[];
  await assert.rejects(resolvePrivateServer(secret,'123',token, async url=>{calls.push(url);return new Response('',{status:302,headers:{location:'https://evil.test/steal'}});}),/did not resolve/); assert.equal(calls.length,1);
  const result = await resolvePrivateServer(secret,'123',token,async()=>new Response("Roblox.GameLauncher.joinPrivateGame(123, 'access-code')")); assert.equal(result.accessCode,'access-code');
  assert.equal((await resolvePrivateServer(secret,'123',token,()=>{throw new Error('should use cache');})).accessCode,'access-code');
});
test('place validation reads official game metadata and handles missing universes', async () => {
  const calls=[]; const game=await gameDetails('123',async url=>{calls.push(url); return Response.json(calls.length===1?{universeId:456}:{data:[{name:'Game',creator:{name:'Creator'},playing:42}]});});
  assert.equal(game.playing,42); assert.equal(game.creator,'Creator'); assert.equal(calls.length,2);
  await assert.rejects(gameDetails('123',async()=>Response.json({})),/No experience/); await assert.rejects(gameDetails('bad'),/numeric/);
});
