$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OrbitWindow {
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

function Get-RobloxWindows {
  $script:found = [System.Collections.Generic.List[object]]::new()
  $cb = [OrbitWindow+EnumProc]{ param($h, $unused)
    if ([OrbitWindow]::IsWindowVisible($h)) {
      [uint32]$ownerId = 0
      [void][OrbitWindow]::GetWindowThreadProcessId($h, [ref]$ownerId)
      try {
        $proc = Get-Process -Id $ownerId -ErrorAction Stop
        if ($proc.ProcessName -eq 'RobloxPlayerBeta') {
          $title = [System.Text.StringBuilder]::new(512)
          [void][OrbitWindow]::GetWindowText($h, $title, 512)
          $script:found.Add(@{ hwnd = $h.ToInt64().ToString(); pid = [int]$ownerId; started = $proc.StartTime.ToUniversalTime().Ticks.ToString(); title = $title.ToString(); minimized = [OrbitWindow]::IsIconic($h) })
        }
      } catch { }
    }
    return $true
  }
  [void][OrbitWindow]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:found.ToArray()
}

function Assert-Window($value) {
  $match = @(Get-RobloxWindows | Where-Object { $_.hwnd -eq $value.hwnd -and $_.pid -eq $value.pid -and $_.started -eq $value.started })
  if ($match.Count -ne 1) { throw 'The attached Roblox window is no longer available.' }
  return [IntPtr]::new([long]$value.hwnd)
}

while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    $result = $null
    switch ($request.op) {
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
