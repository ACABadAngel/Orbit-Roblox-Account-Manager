export class UpdateManager {
  constructor({ updater, available, version, settings, canInstall, prepareInstall = async () => {}, changed = () => {}, schedule = fn => setImmediate(fn) }) {
    this.updater = updater; this.available = available; this.settings = settings; this.canInstall = canInstall; this.prepareInstall = prepareInstall; this.changed = changed; this.schedule = schedule; this.busy = false;
    this.state = { version, status: available ? 'idle' : 'unavailable', nextVersion: '', progress: 0, error: '', channel: settings().updateChannel || 'stable' };
    if (!available) return;
    updater.autoDownload = true; updater.autoInstallOnAppQuit = false; updater.allowDowngrade = false;
    updater.on('checking-for-update', () => this.set({ status: 'checking', error: '' }));
    updater.on('update-available', info => this.set({ status: 'downloading', nextVersion: info.version, progress: 0 }));
    updater.on('update-not-available', () => this.set({ status: 'current', nextVersion: '', error: '' }));
    updater.on('download-progress', progress => this.set({ status: 'downloading', progress: Math.min(100, Math.max(0, progress.percent || 0)) }));
    updater.on('update-downloaded', info => this.set({ status: 'ready', nextVersion: info.version, progress: 100, error: '' }));
    updater.on('error', () => this.set({ status: 'error', error: 'The update could not be downloaded. Check your connection and try again.' }));
  }
  set(value) { Object.assign(this.state, value); this.changed(); }
  snapshot() { return { ...this.state, automatic: this.settings().autoUpdate !== false }; }
  async check() {
    if (!this.available) throw new Error('Automatic updates require the installed Windows app. Install Orbit-Setup; source and portable builds use manual updates.');
    if (this.busy || ['downloading', 'ready', 'installing'].includes(this.state.status)) return this.snapshot();
    this.busy = true;
    try { this.updater.allowPrerelease = this.state.channel === 'beta'; this.updater.channel = this.state.channel === 'beta' ? 'beta' : 'latest'; this.updater.allowDowngrade = false; await this.updater.checkForUpdates(); }
    catch { this.set({ status: 'error', error: 'Could not check GitHub Releases. Try again shortly.' }); }
    finally { this.busy = false; }
    return this.snapshot();
  }
  setChannel(channel) {
    if (!['stable', 'beta'].includes(channel)) throw new Error('Invalid update channel.');
    if (this.busy || ['downloading', 'ready', 'installing'].includes(this.state.status)) throw new Error('Finish the current update before changing channels.');
    this.set({ channel, status: this.available ? 'idle' : 'unavailable', error: '' });
  }
  async install() {
    if (!this.available || this.state.status !== 'ready' || this.busy) throw new Error('No downloaded update is ready.');
    this.busy = true;
    try { await this.canInstall(); await this.prepareInstall(); this.set({ status: 'installing' }); this.schedule(() => this.updater.quitAndInstall(false, true)); }
    finally { this.busy = false; }
  }
}
