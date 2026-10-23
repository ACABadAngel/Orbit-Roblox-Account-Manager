// Ported from Orbit’s existing Windows helper (MIT).
#nullable disable
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
