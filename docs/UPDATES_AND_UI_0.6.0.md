# Orbit 0.6.0: quieter workspace and updates

## Find your controls

- Main navigation: Accounts, Live view, Layouts, Machines.
- More tools: Audio, Schedules, Workflows, Activity.
- Settings categories: General, Launching, Remote, Updates, Account & License.
- Accounts: search, optional Filters, Simple/Detailed view and Open/Launch.
- Click an account row for previews; expand Session details & settings for diagnostics.
- Select account checkboxes for batch launch, stop, health checks and organization.
- The menu beside Launch settings holds health checks, popout, overlay and Stop all.
- Ctrl+K searches actions across the workspace.

## Update flow

The installed Windows app checks shortly after startup when automatic checks are
enabled. A compact dialog blurs the workspace and offers Not now and Update.
It waits for any sign-in, player or other task dialog to close before appearing.

Not now dismisses that version for the current app session. It can be reopened
from the sidebar or Settings → Updates. Starting Orbit again may offer it again.
Update downloads with progress and then requests silent installation and reopening.
The update is never installed simply because the app exits.

If a game, launch queue, sign-in, remote-control lease or import is active, the
restart is held. The downloaded update remains ready; close those tasks and click
Update again. Not now during download lets the download finish but revokes the
automatic restart request. Failed downloads have a retry action.

The NSIS installer also switches to silent mode when invoked with --updated by
older Orbit clients. This suppresses their setup wizard for this upgrade; their
older in-app update screen remains in use until the new app is installed.
Update restarts target the installed executable directly, so a stale Start-menu
shortcut cannot redirect or prevent reopening. Normal first-time setup still
offers a folder picker. Windows may still request
administrator permission when updating a per-machine installation.
Portable and source builds continue to use manual updates.

## Validation

The installed-app check also caught Windows short-path spelling differences.
Renderer IPC now resolves both paths to the same canonical file while retaining
owned-window and main-frame checks. Other files, web URLs and query strings
remain rejected.

Core regression checks include consent, failed-download retries, active-session
protection, deferral races, channels, quiet install flags and automatic reopen.
Browser checks exercise the actual renderer, including hidden/detailed controls,
settings edits across categories, startup prompt, backdrop blur, progress,
Not now, Escape, reopening and waiting for another task dialog to close.

The Windows release pipeline builds the actual NSIS installer, installs it into
a temporary directory, creates a saved workspace, then invokes it as an older
client would: --updated --force-run without /S. It checks that the installer exits
without a wizard, reopens from the original folder, and preserves the workspace.
The existing native input/video/layout/audio fixtures and update-feed checksum
verification also run before publication.
