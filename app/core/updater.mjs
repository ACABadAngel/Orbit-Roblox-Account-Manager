export class UpdateManager {
  constructor({ updater, available, version, settings, canInstall, prepareInstall = async () => {}, changed = () => {}, schedule = fn => setImmediate(fn) }) {
    Object.assign(this, { updater, available, settings, canInstall, prepareInstall, changed, schedule });
    this.busy = false; this.installRequested = false;
    this.state = { version, status: available ? 'idle' : 'unavailable', nextVersion: '', progress: 0, error: '', channel: settings().updateChannel || 'stable' };
    if (!available) return;
    // Checking at startup never downloads, installs, or restarts without consent.
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.allowDowngrade = false;
    updater.on('checking-for-update', () => this.set({ status: 'checking', error: '' }));
    updater.on('update-available', info => this.set({ status: 'available', nextVersion: info.version, progress: 0, error: '' }));
    updater.on('update-not-available', () => this.set({ status: 'current', nextVersion: '', error: '' }));
    updater.on('download-progress', progress => this.set({ status: 'downloading', progress: Math.min(100, Math.max(0, progress.percent || 0)) }));
    updater.on('update-downloaded', info => this.set({ status: 'ready', nextVersion: info.version, progress: 100, error: '' }));
    updater.on('error', () => { this.installRequested = false; this.set({ status: 'error', error: 'The update could not be completed. Check your connection and try again.' }); });
  }
  set(value) { Object.assign(this.state, value); this.changed(); }
  snapshot() { return { ...this.state, automatic: this.settings().autoUpdate !== false }; }
  async check() {
    if (!this.available) throw new Error('Automatic updates require the installed Windows app. Install Orbit-Setup; source and portable builds use manual updates.');
    if (this.busy || ['available', 'downloading', 'ready', 'installing'].includes(this.state.status)) return this.snapshot();
    this.busy = true;
    try { this.updater.allowPrerelease = this.state.channel === 'beta'; this.updater.channel = this.state.channel === 'beta' ? 'beta' : 'latest'; this.updater.allowDowngrade = false; await this.updater.checkForUpdates(); }
    catch { this.set({ status: 'error', error: 'Could not check GitHub Releases. Try again shortly.' }); }
    finally { this.busy = false; }
    return this.snapshot();
  }
  setChannel(channel) {
    if (!['stable', 'beta'].includes(channel)) throw new Error('Invalid update channel.');
    if (this.busy || ['downloading', 'ready', 'installing'].includes(this.state.status)) throw new Error('Finish the current update before changing channels.');
    this.installRequested = false;
    this.set({ channel, status: this.available ? 'idle' : 'unavailable', nextVersion: '', progress: 0, error: '' });
  }
  defer() { this.installRequested = false; return this.snapshot(); }
  async start() {
    if (!this.available || !this.state.nextVersion || !['available', 'ready', 'error'].includes(this.state.status)) throw new Error('No update is available.');
    if (this.busy) return this.snapshot();
    this.installRequested = true;
    if (this.state.status !== 'ready') {
      this.busy = true; this.set({ status: 'downloading', progress: 0, error: '' });
      try { await this.updater.downloadUpdate(); }
      catch { this.installRequested = false; this.set({ status: 'error', error: 'The update could not be downloaded. Your current version is still installed. Try again.' }); }
      finally { this.busy = false; }
    }
    // Re-check sessions after the download: the user may have launched a game.
    if (this.state.status === 'ready' && this.installRequested) {
      try { await this.install(); }
      catch (error) { this.installRequested = false; this.set({ status: 'ready', error: error.message }); }
    }
    return this.snapshot();
  }
  async install() {
    if (!this.available || this.state.status !== 'ready' || this.busy) throw new Error('No downloaded update is ready.');
    this.busy = true;
    try {
      await this.canInstall(); await this.prepareInstall();
      // Not now can arrive while the asynchronous safety check is in progress.
      if (!this.installRequested) return;
      this.set({ status: 'installing', error: '' });
      this.schedule(() => this.updater.quitAndInstall(true, true));
    } finally { this.busy = false; }
  }
}
