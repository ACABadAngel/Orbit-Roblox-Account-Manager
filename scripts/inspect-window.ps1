param([string]$Handle)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InspectWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h, int index);
}
'@
$h = [IntPtr]::new([long]$Handle)
$r = [InspectWindow+RECT]::new()
[void][InspectWindow]::GetWindowRect($h, [ref]$r)
@{ parent = [InspectWindow]::GetParent($h).ToInt64().ToString(); style = [InspectWindow]::GetWindowLong($h, -16); width = $r.Right - $r.Left; height = $r.Bottom - $r.Top } | ConvertTo-Json -Compress
