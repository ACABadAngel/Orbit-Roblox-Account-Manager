# Orbit native C# preview

This branch starts the Windows desktop rewrite of Orbit 0.6.0 in **C# / .NET 10 / WPF**, with an integrated Roblox Player bootstrapper. It is **not yet a feature-complete replacement** for the released Electron app. Keep using stable Orbit for the capabilities marked pending below.

The workspace, account services, installer, layouts, audio and native integration are C#. WebView2 is used only to display Roblox's own sign-in page; it is not the Orbit application shell. No Electron or Node process is needed to run the native executable.

## Run on Windows 10/11

Install the .NET 10 SDK, then from the repository root:

```powershell
dotnet run --project native/Orbit.Desktop/Orbit.Desktop.csproj
```

Roblox sign-in needs the Microsoft Edge WebView2 Runtime. If it is unavailable, the application also accepts a session explicitly pasted or imported by its owner. No normal browser profiles are read.

The **Native C# preview** GitHub Actions workflow produces an **Orbit-Native-Preview-Windows** artifact with a self-contained Windows x64 executable and Windows smoke-test screenshots. This is a development artifact, not an installer or auto-update release. Extract the entire portable folder and run `Orbit.Native.exe`.

## Try the launcher

1. Open **Roblox launcher** and choose **Install / update**. The official Player is installed under Orbit's separate native data folder.
2. Use **Settings** to create a launch profile with a Roblox place ID, optional server job ID and optional FastFlag overrides.
3. **Accounts → Sign in** opens Roblox in an isolated WebView2 profile. Complete Roblox's own sign-in and verification, then choose **Finish sign-in**. Orbit validates the resulting identity before saving it. Alternatively paste/import sessions you own.
4. Assign a profile through **Edit**. Select accounts and choose **Launch selected**.
5. Running status requires an attributed native Roblox window. If more than one new window appears, launches stop and ask for explicit **Attach window** confirmation.
6. **Layouts** lists detected monitor bounds, arranges running windows, and expands/restores each window using tiles. **Audio** sets per-process volume/mute.

For multiple sessions, close Roblox and other instance managers first, keep Orbit open, and enable Multiple sessions before launching. Compatibility still depends on Roblox. Orbit reserves named singleton objects; it does not patch the Player, remove another process's handles or bypass verification.

Roblox's deployment and authentication interfaces can change. Real authentication, client launch and graphics capture require tests on Windows using your own accounts; a successful unit test is not proof of live Roblox compatibility.

## Data and migration

Native data is stored separately at `%LOCALAPPDATA%\Orbit\NativePreview`:

- `workspace.dpapi`: metadata and sessions in one current-user DPAPI-protected envelope.
- `workspace.dpapi.bak`: previous protected generation.
- `Roblox/versions`: verified managed Player versions.
- `Roblox/current.txt`: atomically committed active version.
- `Roblox/Mods`: explicitly supplied local image, sound and font replacements.

The existing Electron workspace/vault is neither read nor modified. There is no automatic vault conversion or legacy-backup import yet. Reconnect accounts explicitly in this preview; keep the original installation and backups for full-feature use.

Saves replace a single protected generation atomically. Recovery uses the last good protected backup and retains the damaged file. Process IDs, HWNDs and tickets are not persisted. Sessions never appear in account lists or activity logs. Do not copy DPAPI data to a different Windows user expecting it to decrypt.

## Bootstrapper behavior

- Fetches Windows Player channel metadata from `clientsettingscdn.roblox.com`.
- Downloads packages only from `setup.rbxcdn.com`; automatic HTTP redirects are disabled.
- Strictly parses Roblox's `v0` manifest, known package names, sizes and MD5 checksums. MD5 checks file integrity; HTTPS and Windows Authenticode establish origin.
- Enforces extraction limits, rejects traversal, drive/ADS/device paths and symlinks.
- Checks Player Authenticode trust and the Roblox Corporation publisher before committing or launching an installation.
- Installs into staging, switches the active pointer only after success, and retains old trees for recovery. Unknown packages stop the install instead of guessing their destinations.
- Repair and explicit updates require closing Roblox. Existing clients are never deliberately killed for an update.
- FastFlags are scalar JSON profiles merged per launch. Roblox's own allowlist remains authoritative; Orbit does not override it.
- Local content replacements are restricted to image/audio/font files under approved content paths. They cannot replace executable binaries or scripts. Repair restores original content. No community mod download marketplace is included.
- Launches are serialized until one unambiguous new game window appears. Rate limits persist across subsequent requests; challenges pause ticket requests until explicit account reconnection.

Orbit is not registered as the system Roblox URL handler in this preview. It does not silently take over an existing Roblox/Froststrap installation.

## Feature parity

| Area | Native preview | Remaining before replacing stable Orbit |
| --- | --- | --- |
| Interface | Native WPF navigation, accounts, launcher, live thumbnails, layouts, audio, settings, activity | Theme parity, command palette, popouts, tray/monitor tools |
| Accounts | Roblox WebView2 sign-in, explicit session/file import, identity validation, aliases, groups, notes, health checks, bulk selection | External browser sign-in, legacy vault/backup migration, richer import formats |
| Launch | Profiles, place/server job IDs, tickets, spacing, multi-session reservation, PID/start-time checks, explicit attachment | Private-server pools, recovery budget, full group overrides |
| Bootstrapper | Install/update/repair, channel, package verification, safe extraction, global/profile flags, restricted local content mods | Protocol registration and restore/uninstall UI, shortcuts, channel discovery, mod inventory/removal, runtime prerequisites |
| Local play | Focus real native game, PrintWindow thumbnails | In-workspace docking and restoration, overlay/popout parity |
| Layouts | Monitor detection, physical pixel arrangement, expand/restore, original-placement recovery | Drag/resize editor, persistent layouts, placement after launch, monitor scaling presentation |
| Audio | Current-process master volume/mute, apply to all accounts | Group and remote-machine controls, audio session retry |
| Remote PCs | Not ported | Certificate-pinned hosting/pairing, authentication, control leases, WebRTC 30/60 FPS, relative input, diagnostics |
| Automation | Not ported | Schedules, workflows, bounded auto-relaunch |
| Licensing/payments | Not ported; preview has local Free functions | KeyAuth, signed receipts, device entitlements, C# service migration; payment activation stays disabled |
| App updates | Separate portable development artifact | Small blurred Update/Not now prompt, silent verified replacement, stable/beta feeds and installer migration |

No missing feature is advertised as working in the native application. The **Migration status** page describes these boundaries in the UI.

## Validate

```powershell
dotnet run --project native/Orbit.Tests/Orbit.Tests.csproj -c Release
dotnet build native/Orbit.slnx -c Release -m:1
dotnet native/Orbit.Desktop/bin/Release/net10.0-windows/Orbit.Native.dll --smoke-test native/artifacts/smoke
```

Core tests run without contacting Roblox and cover install transactions, rejected packages, checksum/signature failure, ZIP escapes, content restrictions, ticket CSRF/verification/rate limits, launch URIs and protected-store recovery. Windows smoke checks exercise DPAPI, publisher rejection and native view rendering with labelled synthetic data. They never sign in or start Roblox.

Before a production cutover, complete the pending rows, test migration and rollback with real backups, validate local and two-PC behavior on Windows, then replace packaging/updater feeds deliberately. Do not tag this preview as stable.

## Reference and licensing

Froststrap was inspected for launcher features and Roblox deployment conventions, particularly `RobloxInterfaces/Deployment.cs`, `Models/Manifest/PackageManifest.cs`, `Models/APIs/Config/PackageMaps.cs` and its bootstrapper flow. The new implementation is independently written for Orbit; it does not vendor Froststrap source or its UI. Froststrap's repository is MPL-2.0. Any future direct reuse must preserve the applicable notices and file-level obligations.

Original Orbit native helper code was ported from this repository's MIT-licensed Windows/audio helpers. WebView2 is distributed under Microsoft's package licence. See the root `THIRD_PARTY_NOTICES.md`.
