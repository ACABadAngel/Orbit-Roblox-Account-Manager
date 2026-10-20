# 0.5.0 validation checkpoint

This is a source checkpoint, not a Windows release certification.

Passed locally:

- JavaScript syntax checks and `git diff --check`.
- All **68** core regression tests, including new coordinate mapping, input
  ordering, video validation, layout validation and migration cases.
- Browser UI smoke checks in Chromium: existing account/license flows plus the
  layout canvas, dragging, saved layouts, live-mode toggle, bulk audio controls,
  and video settings. Desktop/mobile overflow checks also pass.

Still pending:

- The real WebRTC sender/receiver smoke could produce negotiation descriptions,
  but this restricted environment exposed no local ICE candidates. A connection
  and video decode were therefore **not verified locally**. The app now reports
  the missing network address explicitly.
- Windows PowerShell/C# compilation and the native fixture smoke, which now
  checks keyboard/mouse delivery, monitor placement, restoration, audio RPC and
  actual window capture/video decoding.
- The Windows installer build and update-feed verification.
- Real Roblox use on two Windows PCs, including relative camera movement,
  game-specific focus behaviour, mixed-DPI displays and delivered frame rate.

The GitHub workflow includes browser video and Windows fixture checks. Publishing
the source branch was rejected by automatic approval review, so these GitHub
checks and installer publication have not run for 0.5.0.
