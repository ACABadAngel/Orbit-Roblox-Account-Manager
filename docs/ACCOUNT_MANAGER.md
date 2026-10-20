# Orbit account manager (0.4)

Orbit's 0.4 account manager follows the capabilities documented at
https://docs.voltbz.net/docs/account-manager and the restrained dark styling of
https://voltbz.net/. This is an independent implementation; no Volt branding,
assets, execution engine, or proprietary code is included.

## Adding and reviewing accounts

**Add accounts** offers normal Roblox login in a fresh Edge/Chrome profile,
Orbit's existing isolated sign-in window, or bulk session import. Browser login
reads only the temporary profile Orbit opened, imports a validated session, then
closes that browser. Existing browser profiles are never inspected. Complete
Roblox's normal verification yourself. Cancel closes the temporary browser.

For imports, paste one token per line or load `.txt`, `.csv`, or `.log` files.
Files are loaded into the form for review before any validation request. Supported
formats include raw tokens, `.ROBLOSECURITY=value`, and CSV fields containing a
Roblox `_|WARNING:` token. Username/password pairs are not
supported. Import up to 5 MB / 5,000 lines; Roblox requests are sequential. An
existing user ID refreshes its encrypted session and keeps its group, notes,
alias, and running window. The summary reports added, updated, failed line
numbers, and skipped lines. Verification/rate limits stop the batch and pause
launches. Cancel finishes the current request and skips the remaining lines.

Session values and private-server invites are stored only in the OS-encrypted
vault, never in metadata, account snapshots, monitoring windows, or activity logs.
The import form briefly contains only explicitly pasted/file-loaded sessions and
clears them when import starts or closes. Backups include invites in their
separately encrypted payload. Account identities and notes remain local metadata.
Paired controllers can see account metadata, as in earlier Orbit releases.

**Check health** checks selected local accounts, or all local accounts if nothing
is selected. Alive means the session resolves to the saved user ID; expired means
401 or an identity mismatch; unknown means a network/service/challenge error.
A hover tooltip shows the last check. Remote accounts are checked on their host.

## Launch settings

Each group can select a game profile, launch delay (0–120 seconds), automatic
relaunch, recovery delay (5–300 seconds), private-server mode, server pool, and
memory warning threshold. Changes autosave after 1.8 seconds, when switching
groups, and on closing the dialog. **Save & close** waits for persistence. Settings
are applied when an account is launched; an existing game is not moved to a new
place by changing its settings.

Create/edit a game profile to enter a place ID. Orbit resolves its experience,
creator, and current player count through Roblox's own endpoints. Validation is
informational and does not guarantee the account has permission to join.

Multiple sessions must be enabled before starting Roblox. Orbit's Windows helper
holds the required session mutexes while Orbit is open. Already running clients
or competing multi-instance tools can prevent this; close clients before enabling.
The existing bounded queue still serializes window attribution, even with a zero
launch delay. Roblox verification/rate limits always pause the queue.

Per-row relaunch closes only the attached window, waits for it to close, then
prioritizes that account without bypassing an existing verification pause. A
successful launch maps one unambiguous new Roblox window; **Running** does not
prove successful in-game server connection. Attach a window manually if needed.

### Recovery

Automatic relaunch applies only to unexpected disappearance of a tracked window,
when group recovery is enabled and the account is included. Manual Stop cancels
pending recovery. A row shows the recovery countdown; it waits if the launch
queue is paused. At most three automatic launches are attempted per account in a
rolling ten-minute period, then review/manual launch is required. Relaunch does
not resume on app startup. An unsuccessful launch is reported for review instead
of being retried endlessly. Live in-game disconnections with a still-open Roblox
window are not detected.

### Private servers

- **None** uses the account/group's public game profile.
- **Round-robin** rotates through the group's saved server pool, independently of
  other groups, for the current app session.
- **Assigned** uses the server selected on that account's row or Edit dialog.

Each server has a name, place ID, and encrypted invite/code. Only HTTPS Roblox
`/games/…?privateServerLinkCode=…` and `/share?type=Server&code=…` invite URLs are
accepted, plus direct private access codes. Resolution follows only Roblox game
or share redirects and never forwards session credentials to another host. A
successful resolved invite is cached in the encrypted vault for an hour. If
Roblox serves an unsupported share-link page, use the full `/games/` invite or
access code. Orbit reports an error; it never silently joins a public server in
place of a failed private invite. Roblox's own access/privacy restrictions apply.

## Monitoring and layout

The table has group sections, aliases, inline group/server assignment, connection
state, health, committed private memory, CPU, PID, and last-launch time. Search
includes aliases and notes; existing pagination and machine/status filters remain.
Header totals aggregate the reported account processes. CPU is normalized to
whole-machine capacity, so the values can be compared and summed. First samples
show zero CPU until there is a delta; values refresh about every three seconds.
Memory warnings are notifications/activity entries and never terminate a game.

**Pop out** moves management into a separate full workspace window. Closing it
restores the main window. **Overlay** opens a compact, always-on-top local process
monitor with four corner positions. It hides other Orbit windows and suspends
their rendering/preview refresh work while management/recovery continue. Back to
workspace restores the main app. Overlay uses a separate read-only preload and
cannot access sessions, files, settings, license details, or launch controls.

**Ctrl K** opens a searchable command palette. Local native play and paired
remote previews/control, licensing, updates, schedules and workflows are retained.

## Deliberate differences and validation limits

- Orbit does not suppress Roblox's external crash dialogs (“Silent Errors”).
- The memory feature is a warning threshold, not Volt's undocumented “Memory
  Guard” engine. It does not patch processes or kill clients automatically.
- No documented external Volt executor API was found in the supplied account
  manager documentation. There is no injection, decompiler, script broadcast,
  or invented executor connector in this release.
- Share-link handling depends on the Roblox response described above; not every
  share format can be resolved. A full invite/code fallback is available.
- Live process/window monitoring cannot confirm in-game network connection.
- Chrome/Edge login, real Roblox multi-client launching, invite joins, and behavior
  across Roblox updates require manual checks on a Windows PC with authorized
  accounts. CI uses isolated synthetic windows, not Roblox sessions.

Core tests cover import deduplication and redaction, health classification,
recovery budgets, group pacing, private mode selection/redirect restrictions,
metrics calculations, and game lookup errors. Browser smoke checks exercise
layout, autosave, private servers, aliases, commands and existing local-play UI.
Windows CI checks native process counters, window embedding/restoration,
monitor-only IPC, popout management, existing licenses, and installer/update
metadata before publishing.
