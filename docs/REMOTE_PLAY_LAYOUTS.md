# Remote Play, layouts, and audio — 0.5.0

Update Orbit on **both PCs** before testing remote video. Existing vaults and
pairing certificates are preserved. The new stream protocol requires 0.5.0 on
both ends; older hosts can still provide their lightweight screenshot previews.

## Same-PC play

Open an account's **Remote Play → Play here**. The native game is displayed over
the player area as an owned, borderless top-level window. It keeps native game
rendering, audio and foreground input, rather than becoming a Chromium child
window. Click **Focus game** if needed. Moving or resizing Orbit repositions it.
**Return to preview**, closing the player, or exiting Orbit restores its owner,
styles, position and placement. Use windowed mode and the same permission level
for Orbit and Roblox.

**Ctrl + Shift + Backspace** restores local play and expanded layout windows,
then brings Orbit forward. This shortcut must not already be registered by
another application.

## Remote video and control

Keep Orbit open on the host; enable **Settings → Machine hosting → HTTPS host**,
choose **Local network / VPN**, and enable remote input. Pair the PCs using the
host's network address, fingerprint and private pairing token. `127.0.0.1` is
only the computer on which the address is entered.

Remote Play now captures the attached game window as video. The player offers
30/60 FPS targets, maximum 480p/720p/1080p resolutions, 1–40 Mbps bitrate and
adaptive resolution. The defaults are 60 FPS, 720p and 8 Mbps. Chromium prefers
H.264 and chooses an available encoder, with software fallback when necessary.
The target is not a guarantee of 60 delivered frames. The diagnostics show
capture/received frame rate, resolution, received bitrate and network RTT.

Only window sources identified from validated Roblox HWND, PID and process-start
time are available to the capture renderer. No desktop fallback is allowed.
Offers and answers pass through the existing certificate-pinned HTTPS pairing
connection; video and ordered input use direct WebRTC. Both PCs must permit
Orbit on their private network, including UDP. There is **no STUN/TURN service,
internet relay, or automatic NAT traversal**; use a shared LAN or private VPN.
If video cannot connect, the player reports that explicitly; the account grid
continues using its separately configured 1–10 FPS screenshot previews.

Choose **Take control**, then click the video. Choose **Capture mouse** for
relative camera movement. Escape releases capture/control; blur, hidden pages,
closing the player, lost focus, disconnects and lease expiry release held input.
Only one account can receive foreground control on a host at a time.

Clicks exclude letterbox bars and window decorations, using the actual video
dimensions and host window/client rectangles. Geometry is refreshed during the
session. Keyboard events use scan codes through Windows SendInput. Movement is
coalesced while preserving key/button transitions. Windows/game restrictions can
still reject input; Orbit reports those failures instead of claiming success.

This version does not stream audio or support gamepad input. A minimized game,
locked Windows desktop, exclusive fullscreen, or game-specific capture/input
restrictions can prevent correct operation. Restore the game on the host.

## Layouts

Open **Layouts**, select the machine, then choose a detected monitor. Its physical
resolution, scaling and primary-display status are shown. Account positions are
stored relative to the monitor work area, with conversion to native screen
pixels for mixed-DPI and negative-coordinate monitor arrangements.

- Select accounts, choose columns and a gap, then use **Arrange grid** or
  **Focus + sidebar**.
- In edit mode, drag tiles to move them and drag their lower-right handles to
  resize. Positions snap to 1%; the selected tile also has numeric controls.
- Assign different accounts on each monitor. Each account occupies one slot.
- **Save layout** persists the configuration. **Apply to windows** reports a
  result for each account; offline accounts are not silently launched.
- **Place windows automatically** applies that saved slot after launch or manual
  attachment. Only one saved layout is automatic per machine.
- **Compact borderless sizing** uses direct native window sizing instead of the
  normal interactive drag minimum. Orbit reports when the game still enforces a
  larger size. This does not guarantee every Roblox version accepts tiny windows.
- **Switch to live layout** enables window previews. Click a tile to expand its
  actual window to the chosen monitor or return it to its previous placement.
  Use **Ctrl + Shift + Backspace** to return when the full-screen game covers Orbit.
- **Restore originals** restores the positions/styles saved before arrangement.

Refresh monitors after reconnecting or reconfiguring displays. Layouts on an
unavailable monitor report the problem rather than moving windows off-screen.
Remote layout actions require the existing multi-PC entitlement.

## Audio

The **Audio** tab controls a client's Windows audio sessions by its validated
process identity. It never changes the system master volume or unrelated apps.
Set volume/mute individually or apply to selected accounts, the current group,
one machine, or all managed accounts. Existing license rules apply to remote
and cross-machine actions.

Preferences persist per account and are retried when the process creates its
audio session. An offline/silent client is shown as pending. This controls
**all sound** from that client; music-only settings belong to the individual game
and are not changed by Orbit.

## Validation scope

Core regression tests cover video-coordinate mapping, input ordering and limits,
stream negotiation validation, layout validation and old-workspace defaults.
Browser checks exercise the new screens. The Windows fixture smoke additionally
checks native key/click delivery, monitor placement, expand/restore, audio RPC,
and decoding a real window capture through WebRTC at a requested 60 FPS.
Fixtures do not establish Roblox compatibility or a 60 FPS performance result;
those require a real two-PC Windows/Roblox check.
