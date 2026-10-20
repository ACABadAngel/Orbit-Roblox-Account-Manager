$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'audio.cs')
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OrbitWindow {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateMutex(IntPtr attr, bool own, string name);
  [DllImport("kernel32.dll")] public static extern bool ReleaseMutex(IntPtr h);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out RECT rect, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint key, uint type);
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT key; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION value; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  static void Send(INPUT input) {
    if (SendInput(1, new [] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new InvalidOperationException("Windows rejected input. Run Orbit and Roblox at the same permission level.");
  }
  public static void Key(int key, bool up) {
    uint scan = MapVirtualKey((uint)key, 0); bool extended = (key >= 33 && key <= 46) || key == 163 || key == 165 || key == 111;
    INPUT input = new INPUT(); input.type = 1;
    input.value.key = new KEYBDINPUT { vk = (ushort)(scan == 0 ? key : 0), scan = (ushort)scan, flags = (scan == 0 ? 0u : 8u) | (up ? 2u : 0u) | (extended ? 1u : 0u) };
    Send(input);
  }
  public static void Mouse(uint flags, int x, int y, int data) {
    INPUT input = new INPUT(); input.value.mouse = new MOUSEINPUT { dx = x, dy = y, data = unchecked((uint)data), flags = flags }; Send(input);
  }
  public static bool FocusGame(IntPtr h) {
    uint unused; uint target = GetWindowThreadProcessId(h, out unused), self = GetCurrentThreadId();
    IntPtr front = GetForegroundWindow(); uint active = GetWindowThreadProcessId(front, out unused);
    bool a = false, b = false;
    try {
      if (self != active && active != 0) a = AttachThreadInput(self, active, true);
      if (self != target && target != active) b = AttachThreadInput(self, target, true);
      IntPtr root = GetAncestor(h, 2); ShowWindow(root, 9); SetForegroundWindow(root); SetFocus(h);
      return GetForegroundWindow() == root || GetForegroundWindow() == h;
    } finally { if (b) AttachThreadInput(self, target, false); if (a) AttachThreadInput(self, active, false); }
  }
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] static extern IntPtr SetWindowLongPtr64(IntPtr h, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr64(IntPtr h, int index);
  public static void Style(IntPtr h, long value) { SetWindowLong(h, -16, unchecked((int)value)); }
  public static IntPtr Owner(IntPtr h) { return IntPtr.Size == 8 ? GetWindowLongPtr64(h, -8) : new IntPtr(GetWindowLong(h, -8)); }
  public static void SetOwner(IntPtr h, IntPtr owner) { if (IntPtr.Size == 8) SetWindowLongPtr64(h, -8, owner); else SetWindowLong(h, -8, owner.ToInt32()); }
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] public static extern int SetWindowLong(IntPtr h, int index, int value);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct PLACEMENT { public int length, flags, show; public POINT min, max; public RECT normal; }
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref PLACEMENT p);
  [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr h, ref PLACEMENT p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  // Reserve both published singleton names before a Roblox client starts.
  // No game process memory or existing process handles are modified.
  private static readonly System.Collections.Generic.List<IntPtr> multi = new System.Collections.Generic.List<IntPtr>();
  public static bool EnableMulti() {
    if (multi.Count == 2) return true;
    try {
      foreach (string name in new [] { "ROBLOX_singletonMutex", "ROBLOX_singletonEvent" }) {
        IntPtr h = CreateMutex(IntPtr.Zero, true, name);
        int error = Marshal.GetLastWin32Error();
        if (h == IntPtr.Zero) {
          if (error == 6 || error == 5) { DisableMulti(); return false; }
          throw new System.ComponentModel.Win32Exception(error);
        }
        if (error == 183) { CloseHandle(h); DisableMulti(); return false; }
        multi.Add(h);
      }
      return true;
    } catch { DisableMulti(); throw; }
  }
  public static void DisableMulti() {
    foreach (IntPtr h in multi) { ReleaseMutex(h); CloseHandle(h); }
    multi.Clear();
  }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder t, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr e);
}
'@

$script:docked = $null
$script:arranged = @{}
$script:expanded = @{}
# Keep HWND rectangles and cursor coordinates in physical pixels on mixed-DPI monitors.
[void][OrbitWindow]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))

function Read-RobloxWindow([IntPtr]$h) {
  if (-not [OrbitWindow]::IsWindow($h)) { return $null }
  [uint32]$ownerId = 0
  [void][OrbitWindow]::GetWindowThreadProcessId($h, [ref]$ownerId)
  try {
    $proc = Get-Process -Id $ownerId -ErrorAction Stop
    if ($proc.ProcessName -ne 'RobloxPlayerBeta') { return $null }
    $title = [System.Text.StringBuilder]::new(512)
    [void][OrbitWindow]::GetWindowText($h, $title, 512)
    $memoryBytes = $null; $totalCpuMs = $null
    try { $memoryBytes = [long]$proc.PrivateMemorySize64; $totalCpuMs = [double]$proc.TotalProcessorTime.TotalMilliseconds } catch {}
    return @{ hwnd = $h.ToInt64().ToString(); pid = [int]$ownerId; started = $proc.StartTime.ToUniversalTime().Ticks.ToString(); title = $title.ToString(); minimized = [OrbitWindow]::IsIconic($h); memoryBytes = $memoryBytes; totalCpuMs = $totalCpuMs }
  } catch { return $null }
}

function Get-RobloxWindows {
  $script:found = [System.Collections.Generic.List[object]]::new()
  $cb = [OrbitWindow+EnumProc]{ param($h, $unused)
    if ([OrbitWindow]::IsWindowVisible($h)) {
      $value = Read-RobloxWindow $h
      if ($null -ne $value) { $script:found.Add($value) }
    }
    return $true
  }
  [void][OrbitWindow]::EnumWindows($cb, [IntPtr]::Zero)
  # EnumWindows excludes child windows; keep a docked game in window discovery.
  if ($null -ne $script:docked) {
    $value = Read-RobloxWindow $script:docked.handle
    if ($null -ne $value -and -not ($script:found | Where-Object { $_.hwnd -eq $value.hwnd })) { $script:found.Add($value) }
  }
  return $script:found.ToArray()
}

function Assert-Window($value) {
  $current = Read-RobloxWindow ([IntPtr]::new([long]$value.hwnd))
  if ($null -eq $current -or $current.pid -ne $value.pid -or $current.started -ne $value.started) { throw 'The attached Roblox window is no longer available.' }
  return [IntPtr]::new([long]$value.hwnd)
}

function Window-Geometry([IntPtr]$h) {
  $outer = [OrbitWindow+RECT]::new(); $client = [OrbitWindow+RECT]::new(); $visible = [OrbitWindow+RECT]::new(); $point = [OrbitWindow+POINT]::new()
  [void][OrbitWindow]::GetWindowRect($h, [ref]$outer); [void][OrbitWindow]::GetClientRect($h, [ref]$client); [void][OrbitWindow]::ClientToScreen($h, [ref]$point)
  if ([OrbitWindow]::DwmGetWindowAttribute($h, 9, [ref]$visible, 16) -ne 0) { $visible = $outer }
  return @{ outer = @{ x=$outer.Left; y=$outer.Top; width=$outer.Right-$outer.Left; height=$outer.Bottom-$outer.Top }; visible = @{ x=$visible.Left; y=$visible.Top; width=$visible.Right-$visible.Left; height=$visible.Bottom-$visible.Top }; client = @{ x=$point.X; y=$point.Y; width=$client.Right; height=$client.Bottom } }
}
function Save-Game($window) {
  $h = Assert-Window $window; $rect = [OrbitWindow+RECT]::new(); [void][OrbitWindow]::GetWindowRect($h, [ref]$rect)
  $placement = [OrbitWindow+PLACEMENT]::new(); $placement.length = [Runtime.InteropServices.Marshal]::SizeOf($placement); [void][OrbitWindow]::GetWindowPlacement($h, [ref]$placement)
  return @{ window=$window; style=[OrbitWindow]::GetWindowLong($h, -16); rect=$rect; placement=$placement }
}
function Restore-Placement($saved) {
  $h = Assert-Window $saved.window; [void][OrbitWindow]::SetWindowLong($h, -16, $saved.style)
  $r=$saved.rect; [void][OrbitWindow]::SetWindowPos($h, [IntPtr]::Zero, $r.Left, $r.Top, $r.Right-$r.Left, $r.Bottom-$r.Top, 0x0034)
  $placement=$saved.placement; [void][OrbitWindow]::SetWindowPlacement($h, [ref]$placement)
}
function Place-Game($window, $bounds, $compact) {
  $h=Assert-Window $window
  if ($null -ne $script:docked -and $script:docked.window.hwnd -eq $window.hwnd) { throw 'Return this game to its separate window before arranging it.' }
  if ($compact) { $style=[OrbitWindow]::GetWindowLong($h, -16); [OrbitWindow]::Style($h, (($style -band 0xffffffffL) -band (-bnot 0x00C40000L))) }
  [void][OrbitWindow]::ShowWindow($h, 9)
  if (-not [OrbitWindow]::SetWindowPos($h, [IntPtr]::Zero, [int]$bounds.x, [int]$bounds.y, [int]$bounds.width, [int]$bounds.height, 0x0034)) { throw 'Windows could not arrange this game.' }
  return Window-Geometry $h
}

function Restore-Game {
  $saved = $script:docked
  if ($null -eq $saved) { return }
  try { $h = Assert-Window $saved.window } catch { $script:docked = $null; return }
  [OrbitWindow]::SetOwner($h, $saved.parent)
  [void][OrbitWindow]::SetWindowLong($h, -16, $saved.style)
  [void][OrbitWindow]::SetWindowLong($h, -20, $saved.exStyle)
  # Restore the original owner without turning Roblox into a child window.
  if ([OrbitWindow]::Owner($h) -ne $saved.parent) { throw 'Could not restore the separate Roblox window. Keep Orbit open and retry Return to preview.' }
  $r = $saved.rect
  [void][OrbitWindow]::SetWindowPos($h, [IntPtr]::Zero, $r.Left, $r.Top, $r.Right - $r.Left, $r.Bottom - $r.Top, 0x0034)
  $placement = $saved.placement
  [void][OrbitWindow]::SetWindowPlacement($h, [ref]$placement)
  $script:docked = $null
}
function Resize-Game($bounds) {
  if ($null -eq $script:docked) { throw 'No local game is open.' }
  $h = Assert-Window $script:docked.window
  $r = [OrbitWindow+RECT]::new()
  if (-not [OrbitWindow]::GetClientRect($script:docked.host, [ref]$r)) { throw 'Orbit window closed.' }
  # Convert browser CSS coordinates using the real native client size. This also
  # handles Windows scaling and browser zoom without virtualized screen offsets.
  $sx = $r.Right / [double]$bounds.viewportWidth
  $sy = $r.Bottom / [double]$bounds.viewportHeight
  $origin = [OrbitWindow+POINT]::new(); [void][OrbitWindow]::ClientToScreen($script:docked.host, [ref]$origin)
  if (-not [OrbitWindow]::SetWindowPos($h, [IntPtr]::Zero, $origin.X + [int]($bounds.x * $sx), $origin.Y + [int]($bounds.y * $sy), [int]($bounds.width * $sx), [int]($bounds.height * $sy), 0x0074)) { throw 'Could not resize the game window.' }
}

try {

while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    $result = $null
    switch ($request.op) {
      'multi.enable' {
        if (-not [OrbitWindow]::EnableMulti()) { throw 'Close ALL Roblox windows, then retry. Orbit must enable multiple sessions before Roblox starts. Another multi-instance manager may also be holding the session lock.' }
        $result = $true
      }
      'multi.disable' { [OrbitWindow]::DisableMulti(); $result = $true }
      'dock' {
        if ($null -ne $script:docked) { throw 'Close the current local play session first.' }
        $h = Assert-Window $request.window
        $hostWindow = [IntPtr]::new([long]$request.host)
        if (-not [OrbitWindow]::IsWindow($hostWindow)) { throw 'Orbit window is unavailable.' }
        $rect = [OrbitWindow+RECT]::new()
        [void][OrbitWindow]::GetWindowRect($h, [ref]$rect)
        $placement = [OrbitWindow+PLACEMENT]::new()
        $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf($placement)
        [void][OrbitWindow]::GetWindowPlacement($h, [ref]$placement)
        $script:docked = @{ placement = $placement; handle = $h; window = $request.window; host = $hostWindow; parent = [OrbitWindow]::Owner($h); exStyle = [OrbitWindow]::GetWindowLong($h, -20); style = [OrbitWindow]::GetWindowLong($h, -16); rect = $rect; minimized = [OrbitWindow]::IsIconic($h) }
        try {
          [void][OrbitWindow]::ShowWindow($h, 9)
          # An owned top-level window remains a real foreground game. Parenting
          # Roblox into Chromium can leave hover working while gameplay ignores keys.
          $style = (($script:docked.style -band 0xffffffffL) -band (-bnot 0x40C40000L))
          [OrbitWindow]::Style($h, $style)
          [void][OrbitWindow]::SetWindowLong($h, -20, ($script:docked.exStyle -band (-bnot 0x08040000)))
          [OrbitWindow]::SetOwner($h, $hostWindow)
          if ([OrbitWindow]::Owner($h) -ne $hostWindow) { throw 'Windows could not attach Roblox to Orbit. Run both at the same permission level and use windowed mode.' }
          Resize-Game $request.bounds
          [void][OrbitWindow]::FocusGame($h)
          $result = $true
        } catch { Restore-Game; throw }
      }
      'dock.resize' { Resize-Game $request.bounds; $result = $true }
      'undock' { Restore-Game; $result = $true }
      'shutdown' { Restore-Game; foreach ($saved in @($script:expanded.Values)) { try { Restore-Placement $saved } catch {} }; $script:expanded.Clear(); [OrbitWindow]::DisableMulti(); $result = $true }
      'geometry' { $result = Window-Geometry (Assert-Window $request.window) }
      'audio' { $h=Assert-Window $request.window; $result = @{ sessions=[OrbitAudio]::Set([uint32]$request.window.pid, [float]$request.volume, [bool]$request.muted) } }
      'layout.place' {
        $key=[string]$request.window.hwnd + ':' + [string]$request.window.started
        if ($script:expanded.ContainsKey($key)) { Restore-Placement $script:expanded[$key]; $script:expanded.Remove($key) }
        if (-not $script:arranged.ContainsKey($key)) { $script:arranged[$key]=Save-Game $request.window }
        if (-not $request.compact) { [void][OrbitWindow]::SetWindowLong((Assert-Window $request.window), -16, $script:arranged[$key].style) }
        $result=Place-Game $request.window $request.bounds $request.compact
      }
      'layout.restore' {
        $key=[string]$request.window.hwnd + ':' + [string]$request.window.started
        if ($script:expanded.ContainsKey($key)) { Restore-Placement $script:expanded[$key]; $script:expanded.Remove($key) }
        if ($script:arranged.ContainsKey($key)) { Restore-Placement $script:arranged[$key]; $script:arranged.Remove($key) }; $result=$true
      }
      'layout.expand' {
        $key=[string]$request.window.hwnd + ':' + [string]$request.window.started
        if ($script:expanded.ContainsKey($key)) { Restore-Placement $script:expanded[$key]; $script:expanded.Remove($key); $result=@{ expanded=$false } }
        else { $script:expanded[$key]=Save-Game $request.window; $null=Place-Game $request.window $request.bounds $true; [void][OrbitWindow]::FocusGame((Assert-Window $request.window)); $result=@{ expanded=$true } }
      }
      'dock.focus' { if ($null -eq $script:docked) { throw 'No local game is open.' }; $result=[OrbitWindow]::FocusGame((Assert-Window $script:docked.window)) }
      'list' { $result = @(Get-RobloxWindows) }
      'close' { $h = Assert-Window $request.window; [void][OrbitWindow]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); $result = $true }
      'focus' { $h = Assert-Window $request.window; $result = [OrbitWindow]::FocusGame($h) }
      'input' {
        $h = Assert-Window $request.window
        if ([OrbitWindow]::GetForegroundWindow() -ne [OrbitWindow]::GetAncestor($h, 2)) { throw 'Roblox lost focus. Release control and take control again.' }
        $ev = $request.event
        if ($ev.type -in @('mousemove', 'mousedown', 'mouseup', 'wheel')) {
          $rect = [OrbitWindow+RECT]::new()
          $point = [OrbitWindow+POINT]::new()
          [void][OrbitWindow]::GetClientRect($h, [ref]$rect)
          [void][OrbitWindow]::ClientToScreen($h, [ref]$point)
          $x = [Math]::Max(0, [Math]::Min(1, [double]$ev.x))
          $y = [Math]::Max(0, [Math]::Min(1, [double]$ev.y))
          if ($ev.type -ne 'wheel' -and -not $ev.relative) { if (-not [OrbitWindow]::SetCursorPos($point.X + [int]($x * [Math]::Max(1, $rect.Right - 1)), $point.Y + [int]($y * [Math]::Max(1, $rect.Bottom - 1)))) { throw 'Windows rejected cursor movement. Check the active desktop and permission level.' } }
          if ($ev.type -eq 'mousedown') { $flag = if ($ev.button -eq 2) { 0x0008 } elseif ($ev.button -eq 1) { 0x0020 } else { 0x0002 }; [OrbitWindow]::Mouse([uint32]$flag, 0, 0, 0) }
          if ($ev.type -eq 'mouseup') { $flag = if ($ev.button -eq 2) { 0x0010 } elseif ($ev.button -eq 1) { 0x0040 } else { 0x0004 }; [OrbitWindow]::Mouse([uint32]$flag, 0, 0, 0) }
          if ($ev.type -eq 'wheel') { $delta = if ($ev.delta -gt 0) { -120 } else { 120 }; [OrbitWindow]::Mouse(0x0800, 0, 0, $delta) }
        } elseif ($ev.type -eq 'relative') {
          [OrbitWindow]::Mouse(1, [int]$ev.dx, [int]$ev.dy, 0)
        } elseif ($ev.type -in @('keydown', 'keyup')) {
          $key = [int]$ev.key
          if ($key -lt 8 -or $key -gt 222) { throw 'Unsupported key.' }
          $flags = if ($ev.type -eq 'keyup') { 2 } else { 0 }
          [OrbitWindow]::Key($key, ($ev.type -eq 'keyup'))
        } else { throw 'Unsupported input.' }
        $result = $true
      }
      'release' {
        # Always release keys, even after the game closed or changed focus.
        foreach ($key in $request.keys) { if ($key -ge 8 -and $key -le 222) { [OrbitWindow]::Key([int]$key, $true) } }
        [OrbitWindow]::Mouse(0x0054, 0, 0, 0)
        $result = $true
      }
      default { throw 'Unsupported native operation.' }
    }
    [Console]::WriteLine((@{ id = $request.id; result = $result } | ConvertTo-Json -Compress -Depth 8))
  } catch { [Console]::WriteLine((@{ id = $request.id; error = $_.Exception.Message } | ConvertTo-Json -Compress)) }
}

} finally { Restore-Game; foreach ($saved in @($script:expanded.Values)) { try { Restore-Placement $saved } catch {} }; [OrbitWindow]::DisableMulti() }
