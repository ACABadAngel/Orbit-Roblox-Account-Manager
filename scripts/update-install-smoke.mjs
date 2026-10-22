// Verify the actual assisted NSIS installer can upgrade an older-client launch
// (--updated without /S), exit without a wizard, reopen, and preserve data/path.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
if (process.platform !== 'win32') throw new Error('Installer verification requires Windows.');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const installer = resolve(`release/Orbit-Setup-${version}-x64.exe`);
const dir = await mkdtemp(join(tmpdir(), 'orbit-update-')), installDir = join(dir, 'Orbit'), exe = join(installDir, 'Orbit.exe');
function runInstaller(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(installer, args, { stdio: 'inherit' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Installer did not exit: update may have shown the setup wizard.')); }, 75000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Installer exited ${code}`)); });
  });
}
function processes() {
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-Process Orbit -ErrorAction SilentlyContinue | Select-Object Id, Path, MainWindowHandle) | ConvertTo-Json -Compress"], { encoding: 'utf8', env: { ...process.env, ORBIT_INSTALL_TEST_EXE: exe } }).trim();
  if (!result) return []; const value = JSON.parse(result);
  return (Array.isArray(value) ? value : [value]).filter(p => { try { return realpathSync(p.Path).toLowerCase() === realpathSync(exe).toLowerCase(); } catch { return false; } });
}
let instance;
try {
  console.log('Installing the Windows fixture into a temporary folder.');
  await runInstaller(['/S', '/currentuser', `/D=${installDir}`]);
  console.log('Opening the installed application.');
  instance = await _electron.launch({ executablePath: exe, args: ['--disable-gpu'], timeout: 30000 });
  instance.process().stderr.on('data', data => console.log('Installed app stderr:', data.toString().slice(0, 3000)));
  const page = await instance.firstWindow();
  page.on('pageerror', error => console.log('Installed renderer error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('Installed renderer console:', message.text()); });
  await page.getByRole('heading', { name: 'A calmer space for all your accounts.' }).waitFor();
  const userData = await instance.evaluate(({ app }) => app.getPath('userData'));
  await page.evaluate(async () => { await window.orbit.call('settings.save', { autoUpdate: false }); await window.orbit.call('groups.add', { name: 'Upgrade preservation fixture' }); });
  await instance.close(); instance = null;
  // The legacy client supplied these two flags; deliberately omit /S and /D.
  await runInstaller(['--updated', '--force-run']);
  const deadline = Date.now() + 20000; let reopened;
  do { reopened = processes().some(p => Number(p.MainWindowHandle) !== 0); if (!reopened) await new Promise(r => setTimeout(r, 500)); } while (!reopened && Date.now() < deadline);
  assert.ok(reopened, 'The update must reopen Orbit from the original installation folder.');
  const saved = JSON.parse(await readFile(join(userData, 'orbit-data', 'workspace.json'), 'utf8'));
  assert.ok(saved.groups.includes('Upgrade preservation fixture'), 'Updating must preserve the workspace.');
  assert.equal(saved.settings.autoUpdate, false);
  console.log('Installer upgrade passed: legacy --updated launch is silent, reopens Orbit, preserves installation folder and workspace.');
} catch (error) {
  if (instance) for (const page of instance.windows()) {
    console.log('Installed window:', page.url());
    console.log('Installed renderer body:', (await page.locator('body').innerText().catch(() => '')).slice(0, 6000));
  }
  throw error;
} finally {
  if (instance) await instance.close().catch(() => {});
  for (const p of processes()) { try { process.kill(p.Id); } catch {} }
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
