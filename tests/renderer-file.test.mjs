import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rendererFile } from '../app/core/renderer-file.mjs';

test('renderer file guard accepts the exact file and aliases, but rejects another local file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-file-'));
  try {
    const expected = join(dir, 'index.html'), alias = join(dir, 'alias.html'), other = join(dir, 'other.html');
    await writeFile(expected, 'expected'); await writeFile(other, 'other');
    const allowed = rendererFile(expected);
    assert.equal(await allowed(pathToFileURL(expected).href + '#demo'), true);
    assert.equal(await allowed(pathToFileURL(other).href), false);
    assert.equal(await allowed(pathToFileURL(join(dir, 'missing.html')).href), false);
    // Symlink creation on Windows can require privileges; the 8.3 case below
    // uses an injected filesystem resolver and runs on every CI platform.
    if (process.platform !== 'win32') { await symlink(expected, alias); assert.equal(await allowed(pathToFileURL(alias).href), true); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Windows 8.3 names and file casing resolve to the same canonical renderer only', async () => {
  const allowed = rendererFile('/expected/index.html', { platform: 'win32', resolveFile: async path => {
    if (path.includes('other.html')) return 'C:\\Users\\RunnerAdmin\\App\\other.html';
    return path.includes('RUNNER~1') ? 'c:\\users\\runneradmin\\app\\index.html' : 'C:\\Users\\RunnerAdmin\\App\\index.html';
  } });
  assert.equal(await allowed('file:///C:/Users/RUNNER~1/App/index.html'), true);
  assert.equal(await allowed('file:///C:/Users/RUNNER~1/App/other.html'), false);
});
test('renderer file guard rejects web pages, query strings and network file hosts before resolving', async () => {
  let resolutions = 0;
  const allowed = rendererFile('/expected/index.html', { resolveFile: async path => { resolutions++; return path; } });
  for (const url of ['https://example.com/index.html', 'data:text/html,test', 'file:///expected/index.html?other=1', 'file://example.com/index.html', 'not a URL']) assert.equal(await allowed(url), false);
  assert.equal(resolutions, 0);
});
