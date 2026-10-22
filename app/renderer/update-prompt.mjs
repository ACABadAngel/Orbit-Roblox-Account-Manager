import { icon } from './icons.mjs';

// Independent from the working dialog: never interrupt sign-in or a game player.
export class UpdatePrompt {
  constructor({ dialog, blocked, call, changed }) {
    Object.assign(this, { dialog, blocked, call, changed });
    this.deferred = new Set(); this.update = null; this.working = false;
    dialog.innerHTML = `<div class="update-symbol">${icon('download')}</div><p class="update-eyebrow">ORBIT UPDATE</p><h2 id="update-title">New update available</h2><p id="update-description"></p><div class="update-transfer" hidden><progress max="100" value="0" aria-label="Update download"></progress><span id="update-progress" role="status"></span></div><p id="update-error" role="alert" hidden></p><p class="update-hint">Orbit will reopen when the update is finished.</p><div class="update-buttons"><button id="update-later" autofocus>Not now</button><button id="update-now" class="primary">Update</button></div>`;
    dialog.querySelector('#update-later').addEventListener('click', () => this.defer());
    dialog.querySelector('#update-now').addEventListener('click', () => this.start());
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (this.update?.status !== 'installing') this.defer(); });
  }
  async defer() {
    if (this.update?.status === 'installing') return;
    try {
      await this.call('updates.defer');
      this.deferred.add(this.update?.nextVersion); this.dialog.close(); this.changed();
    } catch (error) { this.sync({ ...this.update, error: error.message }); }
  }
  sync(update, { manual = false } = {}) {
    this.update = update;
    const offered = update?.nextVersion && ['available', 'downloading', 'ready', 'installing', 'error'].includes(update.status);
    if (!offered) { if (this.dialog.open) this.dialog.close(); return; }
    if (manual) this.deferred.delete(update.nextVersion);
    if (!this.dialog.open && !this.blocked() && !this.deferred.has(update.nextVersion)) this.dialog.showModal();
    if (!this.dialog.open) return;
    const status = update.status, downloading = status === 'downloading', installing = status === 'installing';
    this.dialog.querySelector('#update-title').textContent = installing ? 'Updating Orbit…' : downloading ? 'Downloading update…' : 'New update available';
    this.dialog.querySelector('#update-description').textContent = installing ? 'Saving your workspace and restarting.' : `Orbit ${update.nextVersion} is ${status === 'ready' ? 'ready to install' : 'available'}. ${status === 'ready' ? 'Update and restart when you’re ready.' : 'Get the latest improvements in one step.'}`;
    this.dialog.querySelector('.update-transfer').hidden = !downloading;
    this.dialog.querySelector('progress').value = update.progress || 0;
    this.dialog.querySelector('#update-progress').textContent = `${Math.round(update.progress || 0)}%`;
    const error = this.dialog.querySelector('#update-error'); error.textContent = update.error || ''; error.hidden = !update.error;
    this.dialog.querySelector('#update-later').disabled = installing;
    const button = this.dialog.querySelector('#update-now'); button.disabled = downloading || installing || this.working; button.textContent = installing ? 'Restarting…' : downloading ? 'Downloading…' : status === 'error' ? 'Try again' : 'Update';
  }
  async start() {
    if (this.working) return;
    this.working = true; this.sync(this.update);
    try { this.sync(await this.call('updates.start')); }
    catch (error) { this.sync({ ...this.update, error: error.message }); }
    finally { this.working = false; this.sync(this.update); this.changed(); }
  }
}
