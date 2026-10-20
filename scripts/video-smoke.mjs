import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { server } from './preview.mjs';

await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ ...(process.env.ORBIT_CHROMIUM ? { executablePath: process.env.ORBIT_CHROMIUM } : {}), headless: true, args: process.env.ORBIT_CHROMIUM_ARGS ? JSON.parse(process.env.ORBIT_CHROMIUM_ARGS) : [] });
const errors = [], inputs = [];
let offerResolve, offerReject;
const offer = new Promise((yes, no) => { offerResolve = yes; offerReject = no; });
const deadline = setTimeout(() => offerReject(new Error('Synthetic capture offer timed out.')), 20000);
const url = `http://127.0.0.1:${server.address().port}/`;
try {
  const host = await browser.newPage();
  host.on('pageerror', e => { errors.push(e.message); offerReject(e); });
  await host.exposeFunction('qaHostCall', async (name, value) => {
    if (name === 'config') return { sourceId: 'window:fixture:0', options: { fps: 60, height: 720, bitrate: 8, adaptive: true } };
    if (name === 'offer') { offerResolve(value); return true; }
    if (name === 'input') { inputs.push(value); return true; }
    if (name === 'error') { errors.push(value); offerReject(new Error(value)); }
    return true;
  });
  await host.addInitScript(() => {
    const RTC = window.RTCPeerConnection; window.RTCPeerConnection = class extends RTC { constructor(...args) { super(...args); window.qaRTC = this; } };
    window.captureHost = { call: (name, value) => window.qaHostCall(name, value), onAnswer: callback => { window.qaAnswer = callback; } };
    // Replace only the OS capture boundary. Production encoder, sender,
    // negotiation, data channel, input pump and receiver remain unchanged.
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      document.body.append(canvas); const ctx = canvas.getContext('2d'); let n = 0;
      const draw = () => { ctx.fillStyle = `hsl(${n++ % 360} 60% 40%)`; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = 'white'; ctx.fillRect(n % 600, 80, 40, 40); requestAnimationFrame(draw); }; draw();
      return canvas.captureStream(60);
    };
  });
  await host.goto(url + 'stream-host.html');
  const sdp = await offer; clearTimeout(deadline);
  const viewer = await browser.newPage(); viewer.on('pageerror', e => errors.push(e.message));
  await viewer.exposeFunction('qaViewerCall', async (name, arg) => {
    if (name === 'stream.start') return { id: 'fixture-stream', offer: sdp, geometry: { client: { x: 0, y: 0, width: 640, height: 360 } } };
    if (name === 'stream.answer') { await host.evaluate(answer => window.qaAnswer(answer), arg.answer); return true; }
    if (name === 'stream.ping') return {};
    if (name === 'stream.stop') return true;
    throw new Error('Unexpected video action: ' + name);
  });
  await viewer.goto(url);
  await viewer.evaluate(async () => {
    const { RemoteVideo } = await import('./remote-video.mjs');
    const surface = document.createElement('div'); document.body.append(surface);
    window.qaVideoErrors = [];
    window.qaPlayer = new RemoteVideo({ call: (name, arg) => window.qaViewerCall(name, arg), id: 'fixture', surface, diagnostics: null, onError: message => window.qaVideoErrors.push(message) });
    await window.qaPlayer.start({ fps: 60, height: 720, bitrate: 8, adaptive: true });
  });
  try { await viewer.waitForFunction(() => window.qaPlayer.ready && window.qaPlayer.video?.videoWidth > 0 && window.qaPlayer.channel?.readyState === 'open', undefined, { timeout: 20000 }); }
  catch (error) {
    console.error('Sender diagnostic', await host.evaluate(() => ({ state: window.qaRTC?.connectionState, ice: window.qaRTC?.iceConnectionState, candidates: window.qaRTC?.localDescription?.sdp.split('\r\n').filter(l => l.startsWith('a=candidate:')) })));
    console.error('Receiver diagnostic', await viewer.evaluate(() => ({ state: window.qaPlayer.connection?.connectionState, ice: window.qaPlayer.connection?.iceConnectionState, errors: window.qaVideoErrors, candidates: window.qaPlayer.connection?.localDescription?.sdp.split('\r\n').filter(l => l.startsWith('a=candidate:')) })));
    throw error;
  }
  await viewer.evaluate(() => {
    window.qaPlayer.leaseToken = 'fixture-lease';
    for (const event of [{ type: 'keydown', key: 87 }, { type: 'relative', dx: 5, dy: 7 }, { type: 'keyup', key: 87 }]) if (!window.qaPlayer.send(event)) throw new Error('Data channel did not send input.');
  });
  await host.waitForFunction(() => true); // Give cross-page delivery an event-loop turn.
  for (let attempt = 0; inputs.length < 3 && attempt < 50; attempt++) await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(inputs.map(v => v.event.type), ['keydown', 'relative', 'keyup']); assert.ok(inputs.every(v => v.leaseToken === 'fixture-lease'));
  const info = await viewer.evaluate(async () => {
    const stats = await window.qaPlayer.connection.getStats();
    return { errors: window.qaVideoErrors, video: [...stats.values()].filter(s => s.type === 'inbound-rtp' && s.kind === 'video').map(s => ({ frames: s.framesDecoded, width: s.frameWidth, height: s.frameHeight })) };
  });
  assert.deepEqual(info.errors, []); assert.ok(info.video.some(v => v.frames > 0 && v.width > 0));
  await viewer.evaluate(() => window.qaPlayer.stop());
  assert.equal(await viewer.evaluate(() => window.qaPlayer.connection.connectionState), 'closed');
  assert.deepEqual(errors, []);
  console.log('Production WebRTC sender/receiver passed: real video decode, ordered input, negotiation and cleanup. Synthetic capture source; no Roblox or 60 FPS performance claim.');
} finally { clearTimeout(deadline); await browser.close(); server.close(); }
