import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
async function walk(dir) { const files = []; for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) files.push(...await walk(p)); else if (/\.(mjs|cjs|js)$/.test(p)) files.push(p); } return files; }
let failed = false;
for (const file of [...await walk('app'), ...await walk('scripts'), ...await walk('tests'), ...await walk('licensing')]) { const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (r.status) { failed = true; console.error(r.stderr); } }
if (failed) process.exit(1);
console.log('JavaScript syntax checks passed.');
