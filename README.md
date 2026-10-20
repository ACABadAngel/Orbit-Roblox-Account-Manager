# Orbit

A Windows desktop workspace for Roblox accounts, game windows, and paired PCs.
Built around a quiet graphite interface with mint accents, an account table,
and a session inspector.

![Orbit account workspace](docs/screenshots/accounts.webp)

## Run it

Requirements: **Windows 10/11**, Node.js **22 or newer**, and an installed Roblox
client or Froststrap. Use Node 24 to match CI.

```sh
npm ci
npm start
```

The app opens with an empty real workspace. **Explore demo** opens isolated
sample data; demo actions never reach the real account vault or launch Roblox.
Exit demo before connecting real accounts.

### Windows download

Every successful [GitHub Actions build](https://github.com/ACABadAngel/Orbit-Roblox-Account-Manager/actions)
uploads an **Orbit-Windows** artifact containing:

- `Orbit-Setup-0.5.0-x64.exe`: installer.
- `Orbit-Portable-0.5.0-x64.exe`: portable application.

Open the latest successful run and download the artifact at the bottom of its
page. These initial builds are unsigned; Windows may show a publisher warning.
You can also build them locally with `npm run dist`.

## Connect and launch

1. Choose **Add accounts → Login from browser** for automatic import through a
   disposable Chrome/Edge profile. Alternatively, use **Built-in sign-in**,
   complete Roblox sign-in, and choose **Finish sign-in** in Orbit. Existing
   sessions can be pasted or loaded from files. Orbit does not collect passwords.
2. In **Settings → Launch profiles**, enter the numeric place ID from a Roblox
   game URL. Optionally specify a server job ID. Assign profiles through the
   account's **Edit** action.
3. Select accounts and choose **Launch**. Orbit obtains a short-lived ticket and
   hands off to the registered `roblox-player` handler. To use a custom installed
   Froststrap launcher, select its `.exe` in Settings.
4. Orbit watches for a single unambiguous new Roblox window. If matching is
   ambiguous, the account remains **Attach window**. Choose **Attach window**
   and verify that the selected game window belongs to that account.

Roblox's authentication and launch endpoints can change. A successful protocol
handoff is not proof of a connected game: **Running** requires a native window.
Existing running windows can be attached manually. Closing a window is detected
as **Disconnected**. Optional group auto-relaunch has a bounded recovery budget.

The app manages many account records; the number of simultaneous Roblox clients
depends on Windows, Roblox, your launcher, the game's rules, and available
hardware. Multiple sessions require Orbit to hold the session mutexes before
Roblox starts (see below). Orbit does not patch Roblox or provide gameplay scripts.

## Remote view and play

1. Install/open Orbit on both computers. On the host, attach the correct Roblox
   windows to its accounts.
2. On the host, enable **Settings → Machine hosting → Enable HTTPS host** and
   select **Local network / VPN**. Enable remote input if desired. Save settings.
3. Choose **Show pairing details**. On the controller, choose **Machines → Pair
   machine**, then enter the address, SHA-256 fingerprint, and pairing token.
   A Windows firewall prompt may require allowing Orbit on your private network.
4. Remote accounts appear in the controller's account list. Open one to watch
   its window or choose **Remote Play → Take control**.

The host certificate is checked against the fingerprint **before** sending the
pairing token. Subsequent connections trust that exact certificate. Host secrets
are encrypted at rest. Token rotation revokes existing controllers.

Remote input is opt-in, limited to an attached `RobloxPlayerBeta` window, and
checks the window's process ID and process start time before input. Only one
account/controller can hold a control lease at once. Losing focus, closing the
player, or a lease timeout releases injected keys and mouse buttons.

**Remote Play in 0.5.0:** the selected remote session uses direct WebRTC window
video with 30/60 FPS targets, 480p/720p/1080p quality, bitrate controls, adaptive
resolution, and capture/receive/network diagnostics. Dashboard thumbnails retain
the independent 1–10 FPS setting. Both PCs need 0.5.0 and private-network firewall
permission for Orbit, including UDP. Pairing/signaling remain certificate-pinned
HTTPS. There is no internet relay or STUN/TURN service; use a LAN or private VPN.
Streaming audio and gamepad input are not implemented. Actual delivery rate and
Roblox compatibility require testing on the user's Windows PCs.

Remote input excludes video black bars/window decorations and uses scan-code
keyboard events. **Take control → Capture mouse** enables relative camera input.
Escape, blur, disconnects and control expiry release held input. Only one account
can receive foreground input on a host at once.

For same-PC play, **Remote Play → Play here** aligns an owned native game window
with the player area, retaining native rendering, audio and foreground focus.
**Return to preview** restores its separate placement and styles. Use windowed
mode and equal permission levels. **Ctrl + Shift + Backspace** returns to Orbit.

**Layouts** detects monitors and their resolution/scaling. Arrange, drag/resize,
save and apply grids, enable placement after launch, or click tiles in live mode
to expand/restore actual windows. Compact borderless sizing attempts direct
native sizing; game-enforced minimums are reported rather than guaranteed away.
**Audio** applies saved per-process volume/mute to accounts, groups and machines.
It changes all client audio, not game-specific music settings.

See [Remote Play, layouts and audio](docs/REMOTE_PLAY_LAYOUTS.md) for setup,
network requirements, restoration controls, limitations and validation scope.

## Updates and licenses

Install the Setup executable once for background update downloads from GitHub
Releases. Open **Updates** to check, choose Stable/Beta, or restart to install.
Restart is blocked while game sessions, sign-in windows, or launches are active.
Source and portable builds use manual updates.

**Account & License** now supports hosted **KeyAuth** license-only activation.
See [KeyAuth setup](docs/licensing/KEYAUTH.md) for public app configuration,
Plus/Pro subscriptions, timed/giveaway keys, and per-feature grants. KeyAuth mode
checks paid access online; Free stays available without a key.

The separate self-hosted service supports activation keys, signed offline receipts, trials,
installation management and Stripe-hosted checkout once the license service is
connected. Free keeps local account management, multiple sessions and native
local play. Plus adds two managed peer PCs, recurring schedules, saved workflows,
extended history and alerts. Pro adds five peers and cross-PC bulk launches.

The server and admin dashboard are included in `licensing/`. Hosting, domain,
public service configuration, Stripe products/credentials and publisher code
signing still need operator setup. The default build is Free; it does not pretend
to have a live paid service. See [setup and operational details](docs/licensing/SETUP.md).

## Multiple sessions on one PC

1. Close **all** Roblox clients and other multi-instance managers.
2. Open Orbit first. **Settings → Multiple sessions** is enabled by default,
   including when upgrading an existing workspace.
3. Launch different accounts from Orbit, leaving Orbit open while playing.

Orbit's persistent Windows helper reserves the named singleton objects before
launching clients. If another process already owns them, launches pause with
instructions instead of knowingly replacing an existing session. Handoffs are
serialized until a new window can be attributed to its account; queued accounts
then remain open simultaneously. Launch concurrency is not the number of running
clients. You can play one selected local window at a time.

Compatibility depends on the Roblox client and selected launcher. The Windows
checks exercise two independent test windows and helper ownership; they do not
prove multi-account Roblox gameplay. If your launcher closes existing clients,
try the registered Roblox handler by clearing the custom launcher selection.
Orbit does not patch the client, close handles in other processes, or change
Roblox verification behavior.

## Launch queue and verification

- Configurable spacing (default 5 seconds, 0–120 seconds per group) and concurrent launch requests
  (default one). These are operational limits, not a promised safe IP threshold.
- CAPTCHA/challenge headers and rate limits pause the queue. `Retry-After`
  is respected, with a minimum one-minute cooldown on rate-limit responses.
- **Stop all** cancels pending and in-flight requests before their next launch
  handoff, and closes attached managed windows on connected hosts.
- Expired sessions and accounts needing verification are skipped until you
  sign in again. Complete Roblox's verification yourself on the host; Orbit
  does not solve or bypass CAPTCHAs.
- Optional automatic relaunch waits 5–300 seconds after an unexpected exit and
  stops after three attempts per account in ten minutes. Manual Stop cancels
  recovery; verification and rate limits pause launches.

## Included workspace tools

- Account search, status/machine filters, groups, multi-selection, pagination,
  account notes, and saved launch profiles.
- Per-host CPU/RAM readings, connection status, and stale/offline host states.
- Account details, live-view grid (up to nine visible previews), screenshots,
  fullscreen preview, and per-session controls.
- One-time local launch/stop schedules. Keep Orbit and the host PC running.
  Schedules more than five minutes late are marked failed rather than replayed.
- Activity history, dark/light themes, and a compact responsive interface.
- Encrypted backup export/import using a separate passphrase. Imports merge
  account/group/profile data; pairing credentials are not exported.

## Local data and protection

Data lives under Electron's user-data directory in `orbit-data/`:

- `workspace.json`: nonsecret account metadata, settings, schedules and history.
- `workspace.json.bak`: last metadata backup.
- `vault.bin`: OS-encrypted Roblox sessions, private invites, host keys and pairing tokens.

On Windows, Electron safeStorage uses DPAPI. The vault is tied to your Windows
user and is not a replacement for protecting that account. Backup files use
scrypt and AES-256-GCM with independent random salts/nonces. Built-in login uses
a sandboxed in-memory session; Chrome/Edge login uses a separate throwaway profile.
Stored vault sessions and authentication tickets are never returned to account
lists or monitors. The import form contains only sessions explicitly pasted or
loaded by you and clears them on import/close. Privileged IPC is restricted to
trusted workspace frames; the overlay has a separate read-only bridge. The host
is off by default.

Do not copy just `vault.bin` to another computer; export a passphrase-protected
Orbit backup instead. Keep backups and their passphrases private.

## Development and checks

```sh
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm run test:desktop   # Windows: actual Electron app, native helper and HTTPS pairing
npm run pack          # Package for the current OS
npm run dist          # Windows: installer + portable app
```

`npm run preview` serves the design at `http://127.0.0.1:4173/#demo`. This browser
preview cannot log into accounts, launch clients, or control game windows.

CI runs core and UI checks on Linux, then native/Electron smoke checks and
installer packaging on Windows. The Linux package is useful for development;
actual Roblox window management targets Windows. Live Roblox authentication,
game launching, capture, and remote input need a real two-PC Windows test with
your own accounts; automated tests do not sign into Roblox.

## Reference projects

Thanks to [Froststrap](https://github.com/Froststrap/Froststrap) for launcher/profile
inspiration and [Roblox Account Manager](https://github.com/ic3w0lf22/Roblox-Account-Manager)
for account organization and launch-flow references. Orbit is an original
implementation and does not bundle either project's code. See
[third-party notices](THIRD_PARTY_NOTICES.md).

## Account manager 0.4

A cleaner graphite workspace adds bulk session/file import, disposable Chrome/Edge sign-in, health checks, aliases, group launch settings, private-server pools/assignment, bounded automatic relaunch, process CPU/memory/PID, a command palette, popout management, and an always-on-top monitor. Existing local native play, paired PC control, licensing, and updates remain available. See [account-manager setup and limitations](docs/ACCOUNT_MANAGER.md).
