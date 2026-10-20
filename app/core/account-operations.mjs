import { randomUUID } from 'node:crypto';
import { parseSessions } from './account-manager.mjs';
import { authenticatedUser, avatarFor } from './roblox.mjs';

export class AccountOperations {
  constructor({ store, save, changed = () => {}, log = () => {}, user = authenticatedUser, avatar = avatarFor, pause = () => {} }) { Object.assign(this, { store, save, changed, log, user, avatar, pause }); this.busy = false; this.cancelled = false; this.progress = null; }
  cancel() { this.cancelled = true; }
  async connect(cookie, group, expectedId) {
    const user = await this.user(cookie);
    if (expectedId && user.id !== expectedId) throw new Error('The session belongs to a different account.');
    let account = this.store.state.accounts.find(a => a.userId === user.id), updated = Boolean(account);
    if (!account) {
      if (this.store.state.accounts.length >= 5000) throw new Error('This workspace already has 5,000 accounts.');
      account = { id: randomUUID(), userId: user.id, group, profileId: this.store.state.profiles[0]?.id, addedAt: Date.now(), status: 'idle', notes: '' }; this.store.state.accounts.push(account);
    }
    Object.assign(account, { username: user.name, displayName: user.displayName || user.name, health: 'alive', checkedAt: Date.now() });
    if (!account.window && !['queued','launching','awaiting-window'].includes(account.status)) { account.status = 'idle'; account.error = ''; }
    this.store.secrets.accounts ||= {}; this.store.secrets.accounts[account.id] = cookie;
    if (!account.avatar) account.avatar = await this.avatar(user.id);
    if (!this.store.state.groups.includes(account.group)) this.store.state.groups.push(account.group);
    await this.save(); this.changed(); return { id: account.id, updated };
  }
  async import(input, group) {
    if (this.busy) throw new Error('Wait for the current import or health check to finish.');
    const rows = parseSessions(input); if (!rows.length) throw new Error('Paste one session per line first.');
    this.busy = true; this.cancelled = false;
    const summary = { imported: 0, updated: 0, failed: [], skipped: 0 };
    try {
      for (let i = 0; i < rows.length; i++) {
        if (this.cancelled) { summary.skipped += rows.length - i; break; }
        this.progress = { kind: 'import', done: i, total: rows.length }; this.changed(); const row = rows[i];
        if (row.error) { summary.failed.push({ line: row.line, reason: row.error }); continue; }
        try { const result = await this.connect(row.token, group); summary[result.updated ? 'updated' : 'imported']++; }
        catch (e) {
          const reason = e.status === 'expired' ? 'Session expired. Sign in again.' : e.pauseQueue ? 'Roblox requires verification or a cooldown. Remaining lines were skipped.' : 'Account validation failed. Check the session and try again.';
          summary.failed.push({ line: row.line, reason });
          if (e.pauseQueue) { this.pause(e); summary.skipped += rows.length - i - 1; break; }
        }
      }
      this.log(`Session import: ${summary.imported} added, ${summary.updated} updated, ${summary.failed.length} failed, ${summary.skipped} skipped.`); return summary;
    } finally { this.busy = false; this.progress = null; this.changed(); }
  }
  async health(ids) {
    if (this.busy) throw new Error('Wait for the current import or health check to finish.');
    const accounts = ids.map(id => this.store.state.accounts.find(a => a.id === id));
    if (!ids.length || ids.length > 5000 || accounts.some(a => !a)) throw new Error('Choose existing local accounts.');
    this.busy = true; this.cancelled = false; const result = { alive: 0, dead: 0, unknown: 0, skipped: 0 };
    try {
      for (let i = 0; i < accounts.length; i++) {
        if (this.cancelled) { result.skipped = accounts.length - i; break; }
        const a = accounts[i]; this.progress = { kind: 'health', done: i, total: accounts.length }; this.changed();
        let stop = false;
        try { const user = await this.user(this.store.secrets.accounts?.[a.id] || ''); a.health = user.id === a.userId ? 'alive' : 'dead'; }
        catch (e) { a.health = e.status === 'expired' ? 'dead' : 'unknown'; if (e.pauseQueue) { this.pause(e); stop = true; } }
        a.checkedAt = Date.now(); result[a.health]++; await this.save();
        if (stop) { result.skipped = accounts.length - i - 1; break; }
      }
      this.log(`Health check: ${result.alive} alive, ${result.dead} expired, ${result.unknown} unknown, ${result.skipped} skipped.`); return result;
    } finally { this.busy = false; this.progress = null; this.changed(); }
  }
}
