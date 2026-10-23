import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'ACABadAngel/Orbit-Roblox-Account-Manager';
export const assetNames = ['Orbit-Native-win-x64.zip', 'Orbit-Native-win-x64.zip.sha256', 'Orbit-Native-Setup.exe'];
export function releaseMetadata(version, sha, repo) {
  if (repo !== repository || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Unexpected release repository or source commit.');
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid native release version.');
  return {
    tag_name: `native-v${version}`, target_commitish: sha, name: `Orbit Native ${version}`,
    body: 'Native Windows account manager and Roblox launcher. Existing native installations can use Settings → Updates or the startup update prompt; the app downloads the portable ZIP, verifies its SHA-256 checksum, replaces the app files and reopens without the installer wizard. Accounts and settings are retained.\n\nThe native application remains in beta. This release is separate from the older Electron app.\n\n' + (version === '0.6.2' ? 'Fixes the RobloxPlayerInstaller.exe manifest error in 0.6.1 and displays the actual app version in the title bar.\n\n' : version === '0.6.3' ? 'Fixes the Unsafe package path error caused by Roblox ZIP directory markers. Includes regression coverage and a real Windows Roblox installation check covering downloads, checksums, extraction and publisher signature.\n\n' : '') + 'Windows build, core checks, view rendering, installation, launch and uninstallation must pass before publication.',
    draft: true, prerelease: version.includes('-'), make_latest: 'false', generate_release_notes: true
  };
}
export async function validateBundle(folder) {
  for (const name of assetNames) if (!(await stat(resolve(folder, name))).isFile() || (await stat(resolve(folder, name))).size === 0) throw new Error(`Missing native release asset: ${name}`);
  const checksum = (await readFile(resolve(folder, assetNames[1]), 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('Invalid native release checksum file.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(resolve(folder, assetNames[0]))) hash.update(chunk);
  if (hash.digest('hex') !== checksum.toLowerCase()) throw new Error('Native release ZIP does not match its checksum.');
}
function complete(release) {
  return assetNames.every(name => release.assets?.some(asset => asset.name === name && asset.state === 'uploaded' && asset.size > 0));
}
export async function publishNative({ version, sha, repo, folder, api, upload }) {
  const metadata = releaseMetadata(version, sha, repo);
  await validateBundle(folder);
  let release;
  try { release = await api('GET', `repos/${repo}/releases/tags/${metadata.tag_name}`); }
  catch (error) { if (error.status !== 404) throw error; }
  if (release && !release.draft) {
    if (!complete(release) || release.prerelease !== metadata.prerelease) throw new Error('Existing published native release is incomplete or has the wrong channel; it was not changed.');
    return { published: false, version, url: release.html_url };
  }
  if (release && release.target_commitish !== sha) throw new Error('An existing draft belongs to another commit; it was not changed.');
  const resume = !!release;
  release ??= await api('POST', `repos/${repo}/releases`, metadata);
  await upload(metadata.tag_name, assetNames.map(name => resolve(folder, name)), resume);
  const staged = await api('GET', `repos/${repo}/releases/${release.id}`);
  if (!complete(staged)) throw new Error('Native assets are incomplete. The release remains a draft.');
  const published = await api('PATCH', `repos/${repo}/releases/${release.id}`, {
    draft: false, prerelease: metadata.prerelease, make_latest: 'false'
  });
  return { published: true, version, url: published.html_url };
}
function ghApi(method, path, body) {
  try {
    const args = ['api', '--method', method, '-H', 'Accept: application/vnd.github+json', path];
    if (body) args.push('--input', '-');
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined }));
  } catch (cause) {
    const error = new Error(`GitHub release request failed: ${method} ${path}. ${cause.stderr?.toString().trim() ?? ''}`);
    error.status = Number(/HTTP (\d{3})/.exec(cause.stderr?.toString() ?? '')?.[1] ?? 0);
    throw error;
  }
}
async function main() {
  const props = await readFile('native/Directory.Build.props', 'utf8');
  const version = /<Version>([^<]+)<\/Version>/.exec(props)?.[1];
  if (!version) throw new Error('Native version is missing.');
  const repo = process.env.GITHUB_REPOSITORY;
  const result = await publishNative({
    version, sha: process.env.GITHUB_SHA, repo, folder: 'native-release', api: ghApi,
    upload: (tag, files, resume) => execFileSync('gh', ['release', 'upload', tag, ...files, '--repo', repo, ...(resume ? ['--clobber'] : [])], { stdio: 'inherit' })
  });
  console.log(result.published ? `Published ${result.url}` : `Already published: ${result.url}. Bump native/Directory.Build.props for another update.`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=${result.published}\nversion=${result.version}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
