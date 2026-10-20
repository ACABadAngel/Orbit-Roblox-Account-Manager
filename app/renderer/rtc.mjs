export async function gather(connection) {
  const ensureAddress = () => { if (!connection.localDescription?.sdp.includes('a=candidate:')) throw new Error('No local video network address is available. Check the active network adapter and Orbit’s private-network firewall permission.'); };
  if (connection.iceGatheringState === 'complete') { ensureAddress(); return; }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Local network video negotiation timed out.')), 12000);
    const change = () => { if (connection.iceGatheringState === 'complete') finish(); };
    const finish = error => { clearTimeout(timer); connection.removeEventListener('icegatheringstatechange', change); error ? reject(error) : resolve(); };
    connection.addEventListener('icegatheringstatechange', change); change();
  });
  ensureAddress();
}
export function preferH264(transceiver) {
  const codecs = RTCRtpSender.getCapabilities('video')?.codecs;
  if (codecs && transceiver.setCodecPreferences) transceiver.setCodecPreferences([...codecs.filter(c => c.mimeType === 'video/H264'), ...codecs.filter(c => c.mimeType !== 'video/H264')]);
}
