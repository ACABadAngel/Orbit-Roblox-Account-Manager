import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const dir = resolve(process.argv[2] || '.orbit-service'); await mkdir(dir, { recursive: true, mode: 0o700 });
const pair = generateKeyPairSync('ed25519');
await writeFile(join(dir, 'signing.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
await writeFile(join(dir, 'admin-token'), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
await writeFile(join(dir, 'public.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
console.log(`Created service credentials in ${dir}. Keep signing.pem and admin-token private and backed up. The desktop needs only public.pem and your HTTPS service URL.`);
