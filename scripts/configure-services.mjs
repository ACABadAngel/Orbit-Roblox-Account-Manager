import { readFile, writeFile } from 'node:fs/promises';
import { serviceOrigin, licensePublicKey } from '../app/core/license-client.mjs';
const path = new URL('../app/config/services.json', import.meta.url);
const current = JSON.parse(await readFile(path, 'utf8'));
const serverUrl = process.env.ORBIT_LICENSE_SERVICE_URL || current.serverUrl, publicKey = process.env.ORBIT_LICENSE_PUBLIC_KEY || current.publicKey;
if (Boolean(serverUrl) !== Boolean(publicKey)) throw new Error('Configure both ORBIT_LICENSE_SERVICE_URL and ORBIT_LICENSE_PUBLIC_KEY.');
const value = serverUrl ? { serverUrl: serviceOrigin(serverUrl), publicKey: licensePublicKey(publicKey) } : { serverUrl: '', publicKey: '' };
await writeFile(path, JSON.stringify(value, null, 2) + '\n');
console.log(value.serverUrl ? 'Public license service configuration included.' : 'No public license service configured. Free mode and manual service connection remain available.');
