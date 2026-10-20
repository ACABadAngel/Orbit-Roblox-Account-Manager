param([string]$Handle)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InspectWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  public static IntPtr Owner(IntPtr h) { return IntPtr.Size == 8 ? GetWindowLongPtr(h, -8) : new IntPtr(GetWindowLong(h, -8)); }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h, int index);
}
'@
$h = [IntPtr]::new([long]$Handle)
$r = [InspectWindow+RECT]::new()
[void][InspectWindow]::GetWindowRect($h, [ref]$r)
@{ parent = [InspectWindow]::GetParent($h).ToInt64().ToString(); owner = [InspectWindow]::Owner($h).ToInt64().ToString(); root = [InspectWindow]::GetAncestor($h, 2).ToInt64().ToString(); style = [InspectWindow]::GetWindowLong($h, -16); width = $r.Right - $r.Left; height = $r.Bottom - $r.Top } | ConvertTo-Json -Compress
