# 0.5.0 validation

Automated validation covers Orbit's implementation and native test windows.
It is not a certification of real Roblox compatibility or delivered 60 FPS.

Passed:

- JavaScript syntax checks, `git diff --check`, and all **68** core regression
  tests, including coordinate mapping, input ordering, stream validation,
  layout validation and migration cases.
- Browser UI smoke checks: account/license flows, layout canvas dragging and
  saving, live-mode toggle, bulk audio, video settings and responsive overflow.
- The production WebRTC sender/receiver test in GitHub's Linux browser runner:
  real video decoding from a synthetic capture source, ordered input delivery,
  negotiation and cleanup. The player also waits for both video transport and
  the input data channel before automatic control.
- Windows helper parsing and C# compilation, desktop startup/persistence,
  certificate-pinned HTTPS pairing and existing license/account flows.
- Windows native fixtures: scan-code keyboard input, mouse clicks, owned
  top-level local play, monitor layouts, expand/restore, audio enumeration and
  saved preferences, and actual HWND window capture decoded through WebRTC
  at a **requested** 60 FPS. Fixtures do not establish audible volume changes
  on the user's audio device or a sustained frame-rate benchmark.

Windows fixtures first passed in the
[0.5.0 validation run](https://github.com/ACABadAngel/Orbit-Roblox-Account-Manager/actions/runs/39472612068).
The workflow reruns these checks for subsequent revisions and publishes the
installer only after packaging and update-feed checksum verification pass.

Manual checks still needed on the user's PCs:

- Real Roblox movement, camera capture and game-specific focus/capture behaviour.
- Two-PC LAN/VPN operation, mixed-DPI displays and actual delivered frame rate.
- Audible per-client volume/mute changes with the user's audio output device.

The restricted local development environment exposed no ICE network candidates,
so video transport was verified on GitHub's runners instead. The app explicitly
reports missing local video addresses and connection failures.
