# Orbit · unified native Windows beta

Orbit combines the Roblox account manager, Player launcher, local game workspace and paired-PC controls in one **C# / .NET 10 / WPF** application. The native application does not require Electron or Node. WebView2 displays Roblox's own sign-in page only.

This is a beta for Windows validation. The stable Electron application remains available for rollback. Do not replace its release/update feed until live Roblox and two-PC testing is complete.

## Install or run

The **Native C# preview** Actions workflow produces `Orbit-Native-Preview-Windows` containing:

- `Orbit-Native-Setup.exe`: per-user installer; no administrator elevation.
- `Orbit-Native-win-x64.zip`: self-contained portable build and future update payload.
- `Orbit-Native-win-x64.zip.sha256`: archive checksum.
- `smoke/`: Windows test results and native screenshots using synthetic CI records.

Install once or extract the portable ZIP and run `Orbit.Native.exe`. Windows 10/11 x64 is required. Roblox sign-in needs Microsoft's Edge WebView2 Runtime. Explicit session/file import is available as an alternative. The beta is unsigned, so Windows can show an unknown-publisher prompt.

From source, with the .NET 10 SDK:

```powershell
dotnet run --project native/Orbit.Desktop/Orbit.Desktop.csproj
```

## One account workspace

**Accounts** is the starting point. Add an account, select its game profile in the session inspector, then launch, play, arrange, capture or adjust its audio. Search, group/status filters, multi-selection and the More actions menu keep bulk controls out of the way until needed. **Ctrl+K** opens searchable commands.

- Sign in directly with Roblox in an isolated WebView2 profile. Complete any Roblox verification yourself, then choose Finish sign-in. Orbit validates the account identity before saving it.
- Explicit paste/file import supports raw sessions, `.ROBLOSECURITY=...` cookies and CSV session fields; it does not interpret passwords as sessions.
- Aliases, notes, groups, profiles, health checks and private-server assignment stay with each account.
- Running status requires an attributed Roblox process/window. Ambiguous new windows require explicit attachment; protocol handoff alone never means Running.
- The inspector opens native local play inside a separate Orbit player window, or focuses the original game window. Closing local play restores its original style, owner and placement. Ctrl+Shift+Backspace returns the game to a separate window.
- Live view and screenshots use the same attached windows. Process PID/start time is checked before native actions so a reused HWND cannot become an unrelated target.
- Audio sets per-process volume/mute, including Apply to every account. Remote machine pages provide their corresponding audio controls. This controls all Roblox audio, not an individual game's music slider.

## Integrated Roblox launcher

**Roblox launcher** manages its own official Player installation:

- Install, update and repair, channel selection, and optional checks before launch.
- Strict package manifest, size and checksum checks; staging and safe extraction; Windows Authenticode trust and Roblox Corporation publisher verification before use.
- Unknown packages, checksum mismatches, traversal/device paths and unsafe archive links fail closed.
- Profile/global FastFlags are merged per launch. Roblox's own allowlist determines what takes effect; Orbit does not bypass it.
- Local image/font/sound replacements under approved content folders are supported. Executable and script replacements are rejected. Repair restores official content.
- Profiles, group spacing, private-server assignment/pools and the selected account all feed the same launch queue.
- Multiple sessions reserve the published singleton names before launching. Close Roblox and other instance managers first, then keep Orbit open. Compatibility depends on the current Roblox client; Orbit does not patch it or remove handles from another process.
- Settings → Roblox URL handler explicitly registers Orbit for this user's `roblox-player` links. The prior handler is saved and can be restored. A per-user named pipe forwards links to an already-open Orbit instance.

The launcher targets Windows Player. It does not claim to implement Roblox Studio, Froststrap's community mod catalogue or every Froststrap integration.

## Group rules, automation and layouts

**Settings → Group launch rules** configures a forced profile, spacing, private-server mode/pool and recovery delay. Unexpected exits can be relaunched automatically, limited to three recovery attempts per account in ten minutes. Manual Stop cancels recovery. Roblox verification and rate limits pause ticket requests; repeated clicks do not bypass the cooldown.

**Automation** saves account workflows and one-time/daily/weekly schedules. Keep Orbit and the PC running. Missed tasks older than five minutes are recorded instead of replayed. Imported schedules are paused until edited and saved. Paid entitlements are checked when the relevant action runs.

**Layouts** detects monitors and physical resolution, supports a quick grid and a drag/resize layout editor, saves normalized placements, and can apply a layout after launch. Live tiles expand a window and restore its prior position; Restore original positions undoes arrangement. Game-enforced minimum sizes remain authoritative. Reassign disconnected or differently named monitors after migration.

The tray icon can restore the workspace or stop sessions. Ctrl+K → Floating monitor opens a small always-on-top session monitor.

## Paired machines and Remote Play

Use this native version on both PCs, on LAN or a private VPN. It does not interoperate with the old Electron wire protocol.

1. On the host, attach accounts to the correct running game windows.
2. Machines → Host settings: enable hosting, choose LAN/VPN, and explicitly permit input if needed. Default native port is **43129**, so it can coexist with the old app on 43128.
3. Allow Orbit in Windows Firewall for the private network. No internet port forwarding or relay is required for LAN/VPN use.
4. Copy the host's address, exact SHA-256 fingerprint and pairing token to the controller's Pair PC form. The fingerprint is checked during TLS before the token is transmitted.
5. Open the machine's accounts to launch, stop, change volume or watch Remote Play. Take control acquires the host's single input lease; Capture mouse enables relative camera movement.

Remote video uses a native **JPEG-over-TLS WebSocket** path with bounded frames and backpressure, replacing the Electron WebRTC implementation. Targets are 30/60 FPS at maximum heights of 480/720/1080. The player shows received FPS; actual throughput depends on PrintWindow compatibility, CPU, resolution and network. It is not a guaranteed 60 FPS encoder. Audio streaming and gamepad input are not provided.

Input maps to client-content coordinates, excluding letterboxing. Host checks bind input to the attached PID/start time. Blur, Escape, disconnect, input disable and an expired lease release held keys/buttons. Only one controller/account can hold foreground input on a host. Rotating the host token invalidates old controllers. Viewing/management grants and device limits are checked on the controller; cleanup/Stop remains available after a grant expires.

## Backups and moving from Electron

In the old app, export an encrypted `.orbit` backup. In native Orbit, use **Backups & migration → Restore backup** with its passphrase. The importer reads the original scrypt/AES-GCM `orbit-backup-v1` format and native PBKDF2/AES-GCM backups.

Merges keep existing accounts and sessions, remap colliding launch profiles, restore account/group/server/layout/automation data, and validate the candidate before changing the active workspace. Existing live native account identities are retained. Imported layouts do not auto-apply and imported schedules are paused. Pairing tokens, host keys and licences are excluded from exports and must be configured separately.

Native data stays in `%LOCALAPPDATA%\Orbit\NativePreview` for continuity with the earlier preview. `workspace.dpapi` contains one current-user Windows-protected envelope; `.bak` is the previous generation. Recovery preserves damaged data before restoring a known-good backup. Existing Electron files are never silently modified. A different Windows user cannot simply copy and decrypt this DPAPI envelope.

## Licences and updates

**Account & Licence** supports KeyAuth licence-only activation with response signature/timestamp checks and HWID binding, or the existing self-hosted Orbit service with Ed25519-signed offline receipts. Public application configuration can be entered in Settings. Never place a seller/admin secret in the desktop app. Native local tools remain Free without a key. Plus/Pro and individual feature grants are enforced for paid operations.

Payments remain disabled. Activating a key does not create a payment subscription. The separate existing licensing server/admin project is not bundled into the Windows desktop executable.

On startup, an available native release opens a small **Not now / Update** dialog over a blurred workspace. An accepted update downloads the portable ZIP, verifies its release checksum, waits for Orbit to exit, replaces files with rollback copies and reopens the app. Game/play windows must be closed first. This skips the initial installer wizard.

Native updates look only for this repository's `native-v...` GitHub releases with `Orbit-Native-win-x64.zip` and its `.sha256` asset. They deliberately do not install old Electron releases or arbitrary Actions artifacts. Stable ignores prereleases; Beta accepts them. Until a native release is published, manual checking correctly reports no newer native release.

## Validation and limits

```powershell
dotnet build native/Orbit.slnx -c Release -m:1
dotnet run --project native/Orbit.Tests/Orbit.Tests.csproj -c Release
dotnet native/Orbit.Desktop/bin/Release/net10.0-windows/Orbit.Native.dll --smoke-test native/artifacts/smoke
```

Core checks cover launcher transactions, corrupted/unsafe packages, protected storage, native/legacy backup migration and atomic merges, profile collisions, private links, recurrence/layout bounds, licence signatures and feature removal, token/pin validation and input-lease expiry. Windows smoke checks exercise DPAPI, native views, a real localhost pinned HTTPS host/client, and wrong-pin/token rejection. They use synthetic records and never contact Roblox or inject input into it.

Before calling a build production-ready, test real Roblox authentication, two independent accounts/windows, local-play restoration, mixed-DPI monitor layouts, audio, and sustained two-PC control/video with the owner's accounts. A compiled app and a green CI run do not prove live Roblox compatibility or a fixed delivery frame rate.

## References

Froststrap was consulted for launcher features and Roblox deployment conventions. Its source is MPL-2.0; this implementation does not vendor Froststrap code. Original Orbit Windows/audio helper code is MIT. WebView2 and Bouncy Castle retain their package licences; see the root third-party notices.
