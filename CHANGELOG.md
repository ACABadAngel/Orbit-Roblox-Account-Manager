# Changelog

## 0.5.0

- Add direct WebRTC window video with 30/60 FPS targets, H.264 preference,
  bitrate/resolution controls, adaptive resolution, and live connection metrics.
- Map remote clicks to displayed game pixels and native client geometry;
  add scan-code keys, ordered/coalesced input and relative camera mouse capture.
- Keep same-PC play as a foreground-capable owned native window, with explicit
  focus, move/resize following, original-placement restoration and a return shortcut.
- Add a monitor-aware Layouts editor, saved multi-monitor grids, drag/resize,
  focus presets, compact direct sizing, automatic placement and expand/restore.
- Add per-client and bulk Windows audio controls with saved volume/mute settings.
- Extend core/browser/native-window checks. Real Roblox compatibility and delivered
  60 FPS remain hardware/network-dependent manual checks.

## 0.3.0

- Add standalone installer updates through GitHub Releases with Stable/Beta
  channels, background download, explicit restart, and active-session guards.
- Add Free/Plus/Pro feature permissions in the main process, preserving free
  local account management, multiple sessions and native local play.
- Add Account & License, Updates and Workflows screens; recurring schedules,
  opt-in desktop alerts, extended history and export.
- Add a separate SQLite license service and protected admin dashboard for
  permanent/timed/batch keys, custom grants, expiry, revocation and device slots.
- Verify Ed25519 activation receipts, limit offline access to 72 hours, and keep
  activation/purchase secrets in the OS-encrypted vault.
- Add optional Stripe-hosted monthly/yearly/prepaid checkout and billing portal,
  verified webhook fulfillment, renewal handling and idempotency.
- Include Docker/HTTPS deployment instructions and public service build config.

The server must be hosted and configured before keys/checkout become available.
Prices and payment credentials are intentionally not supplied by the app. This
release has no customer email/password account or recovery service. Existing
Roblox account data is preserved. Install Setup once to enable future updates.

## 0.2.0

- Add native same-PC play inside Orbit. The selected Roblox window uses its own
  rendering and input rather than the low-rate preview. Closing the player or
  Orbit restores the original separate window.
- Enable multiple-session mode by default, reserving Windows singleton names
  before Roblox starts. Conflicting owners pause launches with instructions.
- Serialize launch-to-window attribution so simultaneous sessions do not
  accidentally attach the same native window to different accounts.
- Keep docked child windows visible to account discovery and disconnect checks.
- Deduplicate and cap notifications; block repeated play requests while pending.
- Add local-play lifecycle tests and Windows fixture checks for two independent
  sessions, native embedding/resizing, mutex conflicts and window restoration.

Real Roblox gameplay and launcher compatibility still require a manual check.
Close all Roblox clients before opening this update, then launch from Orbit.
Account data and profiles are preserved.

## 0.1.1

- Fix launch ticket requests returning HTTP 415: send an explicit JSON content
  type and empty JSON object on both the initial request and CSRF retry.
- Report request-format and service errors separately from account verification.
- Add a regression check against a local HTTP endpoint that rejects missing or
  invalid JSON, then exercises the CSRF retry and ticket response.
- Update project links to the current GitHub account name.

Existing account data and launch profiles are preserved. Install the updated
build, reopen Orbit, and retry Launch. Signing in again is only needed if Roblox
separately reports an expired session or verification requirement.
