$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OrbitWindow {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateMutex(IntPtr attr, bool own, string name);
  [DllImport("kernel32.dll")] public static extern bool ReleaseMutex(IntPtr h);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
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

function Restore-Game {
  $saved = $script:docked
  if ($null -eq $saved) { return }
  try { $h = Assert-Window $saved.window } catch { $script:docked = $null; return }
  [void][OrbitWindow]::SetParent($h, $saved.parent)
  [void][OrbitWindow]::SetWindowLong($h, -16, $saved.style)
  # After removing WS_CHILD, GetParent reports the original top-level owner.
  if ([OrbitWindow]::GetParent($h) -ne $saved.parent) { throw 'Could not restore the separate Roblox window. Keep Orbit open and retry Return to preview.' }
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
  if (-not [OrbitWindow]::SetWindowPos($h, [IntPtr]::Zero, [int]($bounds.x * $sx), [int]($bounds.y * $sy), [int]($bounds.width * $sx), [int]($bounds.height * $sy), 0x0064)) { throw 'Could not resize the game window.' }
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
        $script:docked = @{ placement = $placement; handle = $h; window = $request.window; host = $hostWindow; parent = [OrbitWindow]::GetParent($h); style = [OrbitWindow]::GetWindowLong($h, -16); rect = $rect; minimized = [OrbitWindow]::IsIconic($h) }
        try {
          [void][OrbitWindow]::ShowWindow($h, 9)
          # WS_CHILD; remove WS_POPUP, caption and thick sizing frame.
          $style = (($script:docked.style -band 0xffffffffL) -band (-bnot 0x80C40000L)) -bor 0x40000000L
          [void][OrbitWindow]::SetWindowLong($h, -16, [int]$style)
          [void][OrbitWindow]::SetParent($h, $hostWindow)
          if ([OrbitWindow]::GetParent($h) -ne $hostWindow) { throw 'Windows could not embed Roblox. Run Orbit and Roblox at the same permission level and use windowed mode.' }
          Resize-Game $request.bounds
          $result = $true
        } catch { Restore-Game; throw }
      }
      'dock.resize' { Resize-Game $request.bounds; $result = $true }
      'undock' { Restore-Game; $result = $true }
      'shutdown' { Restore-Game; [OrbitWindow]::DisableMulti(); $result = $true }
      'list' { $result = @(Get-RobloxWindows) }
      'close' { $h = Assert-Window $request.window; [void][OrbitWindow]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); $result = $true }
      'focus' { $h = Assert-Window $request.window; [void][OrbitWindow]::ShowWindow($h, 9); $result = [OrbitWindow]::SetForegroundWindow($h) }
      'input' {
        $h = Assert-Window $request.window
        if ([OrbitWindow]::GetForegroundWindow() -ne $h) { throw 'Roblox lost focus. Release control and take control again.' }
        $ev = $request.event
        if ($ev.type -in @('mousemove', 'mousedown', 'mouseup', 'wheel')) {
          $rect = [OrbitWindow+RECT]::new()
          $point = [OrbitWindow+POINT]::new()
          [void][OrbitWindow]::GetClientRect($h, [ref]$rect)
          [void][OrbitWindow]::ClientToScreen($h, [ref]$point)
          $x = [Math]::Max(0, [Math]::Min(1, [double]$ev.x))
          $y = [Math]::Max(0, [Math]::Min(1, [double]$ev.y))
          if ($ev.type -eq 'mousemove' -or $ev.type -eq 'mousedown') { [void][OrbitWindow]::SetCursorPos($point.X + [int]($x * [Math]::Max(1, $rect.Right - 1)), $point.Y + [int]($y * [Math]::Max(1, $rect.Bottom - 1))) }
          if ($ev.type -eq 'mousedown') { $flag = if ($ev.button -eq 2) { 0x0008 } else { 0x0002 }; [OrbitWindow]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero) }
          if ($ev.type -eq 'mouseup') { $flag = if ($ev.button -eq 2) { 0x0010 } else { 0x0004 }; [OrbitWindow]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero) }
          if ($ev.type -eq 'wheel') { $delta = if ($ev.delta -gt 0) { -120 } else { 120 }; [OrbitWindow]::mouse_event(0x0800, 0, 0, [uint32]($delta -band 0xffffffffL), [UIntPtr]::Zero) }
        } elseif ($ev.type -in @('keydown', 'keyup')) {
          $key = [int]$ev.key
          if ($key -lt 8 -or $key -gt 222) { throw 'Unsupported key.' }
          $flags = if ($ev.type -eq 'keyup') { 2 } else { 0 }
          [OrbitWindow]::keybd_event([byte]$key, 0, $flags, [UIntPtr]::Zero)
        } else { throw 'Unsupported input.' }
        $result = $true
      }
      'release' {
        # Always release keys, even after the game closed or changed focus.
        foreach ($key in $request.keys) { if ($key -ge 8 -and $key -le 222) { [OrbitWindow]::keybd_event([byte]$key, 0, 2, [UIntPtr]::Zero) } }
        [OrbitWindow]::mouse_event(0x0014, 0, 0, 0, [UIntPtr]::Zero)
        $result = $true
      }
      default { throw 'Unsupported native operation.' }
    }
    [Console]::WriteLine((@{ id = $request.id; result = $result } | ConvertTo-Json -Compress -Depth 8))
  } catch { [Console]::WriteLine((@{ id = $request.id; error = $_.Exception.Message } | ConvertTo-Json -Compress)) }
}

} finally { Restore-Game; [OrbitWindow]::DisableMulti() }
