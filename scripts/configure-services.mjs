import { readFile, writeFile } from 'node:fs/promises';
import { serviceOrigin, licensePublicKey } from '../app/core/license-client.mjs';
import { keyauthConfiguration } from '../app/core/keyauth-client.mjs';
const path = new URL('../app/config/services.json', import.meta.url);
const current = JSON.parse(await readFile(path, 'utf8'));
const provider = process.env.ORBIT_LICENSE_PROVIDER || current.provider || 'orbit';
if (!['keyauth', 'orbit'].includes(provider)) throw new Error('Unknown ORBIT_LICENSE_PROVIDER.');
let value;
if (provider === 'keyauth') {
  const keyauth = {
    name: process.env.ORBIT_KEYAUTH_NAME || current.keyauth?.name || '',
    ownerid: process.env.ORBIT_KEYAUTH_OWNER_ID || current.keyauth?.ownerid || '',
    version: process.env.ORBIT_KEYAUTH_VERSION || current.keyauth?.version || '1.0',
    subscriptions: process.env.ORBIT_KEYAUTH_SUBSCRIPTIONS ? JSON.parse(process.env.ORBIT_KEYAUTH_SUBSCRIPTIONS) : current.keyauth?.subscriptions
  };
  // Empty shipped configuration permits manual setup. Partly supplied details fail the build.
  value = { provider, keyauth: keyauth.name || keyauth.ownerid ? keyauthConfiguration(keyauth) : { ...keyauth, subscriptions: keyauth.subscriptions || { free: 'free', plus: 'plus', pro: 'pro' } }, serverUrl: '', publicKey: '' };
} else {
  const serverUrl = process.env.ORBIT_LICENSE_SERVICE_URL || current.serverUrl, publicKey = process.env.ORBIT_LICENSE_PUBLIC_KEY || current.publicKey;
  if (Boolean(serverUrl) !== Boolean(publicKey)) throw new Error('Configure both ORBIT_LICENSE_SERVICE_URL and ORBIT_LICENSE_PUBLIC_KEY.');
  value = { provider, ...(serverUrl ? { serverUrl: serviceOrigin(serverUrl), publicKey: licensePublicKey(publicKey) } : { serverUrl: '', publicKey: '' }) };
}
await writeFile(path, JSON.stringify(value, null, 2) + '\n');
console.log(provider === 'keyauth' ? value.keyauth.name ? 'Public KeyAuth application configuration included.' : 'KeyAuth is ready for manual connection. Free mode remains available.' : value.serverUrl ? 'Public license service configuration included.' : 'No public license service configured. Free mode and manual service connection remain available.');
