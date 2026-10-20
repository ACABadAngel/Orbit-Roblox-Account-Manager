import { InputPump } from './input-pump.mjs';
import { gather, preferH264 } from './rtc.mjs';
const api = window.captureHost;
let connection, media, timer, busy = false;
let pump;
try {
  const { sourceId, options } = await api.call('config');
  media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: Math.round(options.height * 16 / 9), maxHeight: options.height, maxFrameRate: options.fps } } });
  const track = media.getVideoTracks()[0]; track.contentHint = 'motion'; await track.applyConstraints({ frameRate: { ideal: options.fps, max: options.fps } });
  connection = new RTCPeerConnection({ iceServers: [] });
  const sender = connection.addTrack(track, media);
  preferH264(connection.getTransceivers()[0]);
  const parameters = sender.getParameters(); parameters.encodings ||= [{}];
  parameters.encodings[0].maxBitrate = options.bitrate * 1000000; parameters.encodings[0].maxFramerate = options.fps; parameters.degradationPreference = 'maintain-framerate';
  await sender.setParameters(parameters);
  const channel = connection.createDataChannel('orbit-input', { ordered: true });
  pump = new InputPump(data => api.call('input', data), error => { if (channel.readyState === 'open') channel.send(JSON.stringify({ error: error.message })); });
  channel.onmessage = event => {
    if (typeof event.data !== 'string' || event.data.length > 4096) return;
    try { pump.push(JSON.parse(event.data)); } catch {}
  };
  channel.onclose = () => api.call('disconnected').catch(() => {});
  track.onended = () => api.call('error', 'The Roblox capture window closed.').catch(() => {});
  api.onAnswer(answer => connection.setRemoteDescription(answer).catch(e => api.call('error', e.message)));
  connection.onconnectionstatechange = () => { if (['failed', 'closed'].includes(connection.connectionState)) api.call('disconnected').catch(() => {}); };
  await connection.setLocalDescription(await connection.createOffer()); await gather(connection);
  await api.call('offer', { type: 'offer', sdp: connection.localDescription.sdp });
  let scale = 1, good = 0;
  timer = setInterval(async () => {
    if (busy || connection.connectionState !== 'connected') return; busy = true;
    try {
      const stats = await connection.getStats(); let limited = false, captureFps = 0, encodeFps = 0, encoder = '';
      for (const s of stats.values()) { if (s.type === 'media-source' && s.kind === 'video') captureFps = s.framesPerSecond || 0; if (s.type === 'outbound-rtp' && s.kind === 'video') { encodeFps = s.framesPerSecond || 0; encoder = s.encoderImplementation || ''; } }
      if (channel.readyState === 'open') channel.send(JSON.stringify({ telemetry: { captureFps, encodeFps, encoder } }));
      if (!options.adaptive) return;
      for (const s of stats.values()) if (s.type === 'outbound-rtp' && s.kind === 'video') limited = ['cpu', 'bandwidth'].includes(s.qualityLimitationReason);
      if (limited) { scale = Math.min(2, scale + .25); good = 0; } else if (++good >= 5) { scale = Math.max(1, scale - .25); good = 0; }
      const p = sender.getParameters(); if (p.encodings?.length && p.encodings[0].scaleResolutionDownBy !== scale) { p.encodings[0].scaleResolutionDownBy = scale; await sender.setParameters(p); }
    } catch {} finally { busy = false; }
  }, 2000);
} catch (error) { await api.call('error', error.message).catch(() => {}); }
window.addEventListener('beforeunload', () => { clearInterval(timer); pump?.close(); connection?.close(); media?.getTracks().forEach(t => t.stop()); });
