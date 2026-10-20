import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import yaml from 'js-yaml';
const pkg = JSON.parse(await readFile('package.json', 'utf8')), files = await readdir('release');
const feeds = files.filter(name => /^(latest|beta).*\.yml$/.test(name)); assert.ok(feeds.length, 'Missing update feed');
for (const name of feeds) {
  const feed = yaml.load(await readFile(join('release', name), 'utf8')); assert.equal(feed.version, pkg.version);
  assert.ok(feed.files?.length, 'Missing update files');
  for (const file of feed.files) {
    assert.equal(basename(file.url), file.url, 'Feed must reference a release asset');
    const path = join('release', file.url), bytes = await readFile(path);
    assert.equal(createHash('sha512').update(bytes).digest('base64'), file.sha512, 'Installer checksum mismatch');
    if (file.size !== undefined) assert.equal((await stat(path)).size, file.size);
    assert.match(file.url, /^Orbit-Setup-.*\.exe$/, 'Automatic updates must use the installer');
  }
}
const config = yaml.load(await readFile('release/win-unpacked/resources/app-update.yml', 'utf8'));
assert.equal(config.provider, 'github'); assert.equal(config.owner, 'ACABadAngel'); assert.equal(config.repo, 'Orbit-Roblox-Account-Manager');
console.log('Release checks passed: package version, installer update feed, SHA-512, asset sizes, and embedded public GitHub provider.');
