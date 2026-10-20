import { gather } from './rtc.mjs';
export class RemoteVideo {
  constructor({ call, id, surface, diagnostics, onError }) { Object.assign(this, { call, id, surface, diagnostics, onError }); this.closed = false; this.ready = false; this.leaseToken = null; this.lastStats = null; }
  async start(options) {
    try {
      const session = await this.call('stream.start', { id: this.id, options }); this.session = session;
      if (this.closed) { await this.stop(); return; }
      this.geometry = session.geometry;
      this.connection = new RTCPeerConnection({ iceServers: [] });
      const video = document.createElement('video'); this.video = video;
      video.autoplay = true; video.playsInline = true; video.muted = true; video.setAttribute('aria-label', 'Live Roblox video stream');
      this.surface.replaceChildren(video);
      this.connection.ontrack = event => { video.srcObject = event.streams[0] || new MediaStream([event.track]); video.play().catch(() => {}); };
      this.connection.ondatachannel = event => { this.channel = event.channel; this.channel.onmessage = message => { try { const r = JSON.parse(message.data); if (r.telemetry) this.telemetry = r.telemetry; if (r.error) { this.leaseToken = null; this.onError(r.error); } } catch {} }; };
      this.connection.onconnectionstatechange = () => {
        if (this.closed) return;
        this.ready = this.connection.connectionState === 'connected';
        if (this.connection.connectionState === 'failed') this.fail('Video connection failed. Allow Orbit through Windows Firewall on the private network of both PCs. Use the same LAN or VPN; no relay is configured.');
        if (this.connection.connectionState === 'disconnected') { this.leaseToken = null; this.onError('Video disconnected. Control was released. Reopen this session if it does not reconnect.'); }
      };
      await this.connection.setRemoteDescription(session.offer);
      await this.connection.setLocalDescription(await this.connection.createAnswer()); await gather(this.connection);
      if (this.closed) return;
      await this.call('stream.answer', { id: this.id, streamId: session.id, answer: { type: 'answer', sdp: this.connection.localDescription.sdp } });
      this.keepalive = setInterval(() => { this.call('stream.ping', { id: this.id, streamId: session.id }).then(r => { if (r.geometry) this.geometry = r.geometry; }).catch(e => this.fail(e.message)); }, 4000);
      this.statsTimer = setInterval(() => this.stats(options).catch(() => {}), 1000);
      this.connectTimer = setTimeout(() => { if (!this.ready) this.fail('Video could not connect. Allow Orbit through the private-network firewall on both PCs; video uses direct UDP in addition to the HTTPS pairing port.'); }, 15000);
    } catch (error) { if (!this.closed) this.fail(error.message); }
  }
  send(event) {
    if (!this.leaseToken || this.channel?.readyState !== 'open') return false;
    if (this.channel.bufferedAmount > 32768) { this.leaseToken = null; this.onError('Input connection is congested. Control was released.'); return false; }
    this.channel.send(JSON.stringify({ event, leaseToken: this.leaseToken })); return true;
  }
  async stats(options) {
    if (this.closed || !this.connection) return;
    const stats = await this.connection.getStats(); let inbound, transport, pair;
    for (const s of stats.values()) { if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s; if (s.type === 'transport') transport = s; }
    if (transport) pair = stats.get(transport.selectedCandidatePairId);
    if (!pair) for (const s of stats.values()) if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) pair = s;
    const old = this.lastStats, seconds = old && inbound ? (inbound.timestamp - old.timestamp) / 1000 : 0;
    const fps = inbound?.framesPerSecond ?? (seconds > 0 ? Math.round((inbound.framesDecoded - old.framesDecoded) / seconds) : 0);
    const mbps = seconds > 0 ? ((inbound.bytesReceived - old.bytesReceived) * 8 / seconds / 1000000).toFixed(1) : '0';
    this.lastStats = inbound;
    if (this.diagnostics?.isConnected) this.diagnostics.textContent = `${this.connection.connectionState} · ${this.telemetry?.captureFps || 0} capture / ${fps || 0} received / ${options.fps} target FPS · ${inbound?.frameWidth || 0}×${inbound?.frameHeight || 0} · ${mbps} Mbps · ${Math.round((pair?.currentRoundTripTime || 0) * 1000)} ms RTT · ${this.leaseToken ? 'Input active' : 'View only'}`;
  }
  fail(message) { if (this.closed) return; this.onError(message); this.stop().catch(() => {}); }
  async stop() {
    this.closed = true; this.ready = false; this.leaseToken = null;
    clearTimeout(this.connectTimer); clearInterval(this.keepalive); clearInterval(this.statsTimer);
    this.channel?.close(); this.connection?.close(); this.video?.srcObject?.getTracks().forEach(t => t.stop());
    if (this.session) { const id = this.session.id; this.session = null; await this.call('stream.stop', { id: this.id, streamId: id }).catch(() => {}); }
  }
}
