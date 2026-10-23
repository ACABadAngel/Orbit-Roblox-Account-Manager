using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Orbit.Core;

namespace Orbit.Desktop;
public sealed class DpapiProtector : ISecretProtector
{
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Size; public nint Data; }
    [DllImport("crypt32.dll", SetLastError = true)] private static extern bool CryptProtectData(ref Blob input, nint description, nint entropy, nint reserved, nint prompt, uint flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true)] private static extern bool CryptUnprotectData(ref Blob input, nint description, nint entropy, nint reserved, nint prompt, uint flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern nint LocalFree(nint pointer);
    public byte[] Protect(byte[] data) => Transform(data, true);
    public byte[] Unprotect(byte[] data) => Transform(data, false);
    private static byte[] Transform(byte[] data, bool encrypt)
    {
        var input = new Blob { Size = data.Length, Data = Marshal.AllocHGlobal(data.Length) };
        try
        {
            Marshal.Copy(data, 0, input.Data, data.Length);
            Blob output;
            var ok = encrypt ? CryptProtectData(ref input, 0, 0, 0, 0, 1, out output) : CryptUnprotectData(ref input, 0, 0, 0, 0, 1, out output);
            if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());
            try { var result = new byte[output.Size]; Marshal.Copy(output.Data, result, 0, result.Length); return result; }
            finally { for (var i = 0; i < output.Size; i++) Marshal.WriteByte(output.Data, i, 0); LocalFree(output.Data); }
        }
        finally { for (var i = 0; i < input.Size; i++) Marshal.WriteByte(input.Data, i, 0); Marshal.FreeHGlobal(input.Data); }
    }
}
public static class PublisherVerifier
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct FileInfo { public uint Size; public nint Path, File, Subject; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct TrustData
    {
        public uint Size; public nint Policy, Sip; public uint Ui, Revocation, Choice; public nint File; public uint StateAction; public nint State, Url; public uint Flags, Context;
    }
    [DllImport("wintrust.dll", ExactSpelling = true)] private static extern int WinVerifyTrust(nint window, ref Guid action, ref TrustData data);
    public static bool Roblox(string path)
    {
        var name = Marshal.StringToCoTaskMemUni(path); var filePointer = Marshal.AllocHGlobal(Marshal.SizeOf<FileInfo>());
        try
        {
            var info = new FileInfo { Size = (uint)Marshal.SizeOf<FileInfo>(), Path = name };
            Marshal.StructureToPtr(info, filePointer, false);
            var data = new TrustData { Size = (uint)Marshal.SizeOf<TrustData>(), Ui = 2, Choice = 1, File = filePointer, Flags = 0x1000 };
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
            if (WinVerifyTrust(new nint(-1), ref action, ref data) != 0) return false;
#pragma warning disable SYSLIB0057 // Signed PE certificate extraction has no X509CertificateLoader equivalent.
            using var cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
#pragma warning restore SYSLIB0057
            return cert.GetNameInfo(X509NameType.SimpleName, false).Equals("Roblox Corporation", StringComparison.OrdinalIgnoreCase);
        }
        catch (CryptographicException) { return false; }
        finally { Marshal.FreeHGlobal(filePointer); Marshal.FreeCoTaskMem(name); }
    }
}
public sealed record GameWindow(nint Handle, int Pid, DateTime StartTime, string Title)
{
    public override string ToString() => $"{Title} · PID {Pid}";
}
public static class GameWindows
{
    public static List<GameWindow> List()
    {
        var windows = new List<GameWindow>();
        OrbitWindow.EnumWindows((h, _) =>
        {
            if (!OrbitWindow.IsWindowVisible(h)) return true;
            OrbitWindow.GetWindowThreadProcessId(h, out var pid);
            try
            {
                using var process = Process.GetProcessById((int)pid);
                if (process.ProcessName != "RobloxPlayerBeta") return true;
                var title = new StringBuilder(512); OrbitWindow.GetWindowText(h, title, title.Capacity);
                windows.Add(new(h, process.Id, process.StartTime.ToUniversalTime(), title.ToString()));
            }
            catch (Exception e) when (e is ArgumentException or InvalidOperationException or Win32Exception) { }
            return true;
        }, 0);
        return windows;
    }
    public static bool Owned(Account account)
    {
        if (account.Window == 0 || !OrbitWindow.IsWindow(account.Window)) return false;
        OrbitWindow.GetWindowThreadProcessId(account.Window, out var pid);
        if (pid != account.ProcessId) return false;
        try { using var process = Process.GetProcessById((int)pid); return process.ProcessName == "RobloxPlayerBeta" && process.StartTime.ToUniversalTime() == account.ProcessStart; }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException or Win32Exception) { return false; }
    }
    public static void Attach(Account account, GameWindow window)
    { account.Window = window.Handle; account.ProcessId = window.Pid; account.ProcessStart = window.StartTime; account.Status = "Running"; account.AudioApplied=false; account.Error = ""; }
    public static void Stop(Account a) { if (Owned(a)) OrbitWindow.PostMessage(a.Window, 0x10, 0, 0); a.Window = 0; a.Status = "Idle"; }
    public static void Focus(Account a) { if (!Owned(a)) throw new InvalidOperationException("Attach this account’s running Roblox window first."); OrbitWindow.FocusGame(a.Window); }
}
public sealed class LayoutService : IDisposable
{
    private readonly Dictionary<string, (nint Handle, OrbitWindow.PLACEMENT Placement, int Style)> originals = [];
    private readonly Dictionary<string, OrbitWindow.PLACEMENT> expanded = [];
    private void Remember(Account a)
    {
        if (!GameWindows.Owned(a)) throw new InvalidOperationException("Attach a running Roblox window first.");
        if (originals.ContainsKey(a.Id)) return;
        var p = new OrbitWindow.PLACEMENT { length = Marshal.SizeOf<OrbitWindow.PLACEMENT>() };
        if (!OrbitWindow.GetWindowPlacement(a.Window, ref p)) throw new Win32Exception();
        originals[a.Id] = (a.Window, p, OrbitWindow.GetWindowLong(a.Window, -16));
    }
    public void Place(Account a,System.Drawing.Rectangle monitor,WindowSlot slot)
    {Remember(a);OrbitWindow.ShowWindow(a.Window,9);if(!OrbitWindow.SetWindowPos(a.Window,0,monitor.X+(int)(slot.X*monitor.Width),monitor.Y+(int)(slot.Y*monitor.Height),Math.Max(100,(int)(slot.Width*monitor.Width)),Math.Max(100,(int)(slot.Height*monitor.Height)),0x14))throw new Win32Exception();}
    public void Apply(IReadOnlyList<Account> accounts, System.Drawing.Rectangle monitor, int columns)
    {
        if (accounts.Count == 0 || columns is < 1 or > 8) throw new ArgumentException("Select running accounts and 1–8 columns.");
        foreach (var a in accounts) Remember(a);
        var rows = (int)Math.Ceiling(accounts.Count / (double)columns);
        for (var i = 0; i < accounts.Count; i++)
        {
            var a = accounts[i];
            var x = monitor.X + i % columns * monitor.Width / columns; var y = monitor.Y + i / columns * monitor.Height / rows;
            OrbitWindow.ShowWindow(a.Window, 9);
            if (!OrbitWindow.SetWindowPos(a.Window, 0, x, y, monitor.Width / columns, monitor.Height / rows, 0x14)) throw new Win32Exception();
        }
    }
    public void Toggle(Account a, System.Drawing.Rectangle monitor)
    {
        Remember(a);
        if (expanded.Remove(a.Id, out var previous))
        { OrbitWindow.SetWindowPlacement(a.Window, ref previous); }
        else { var p = new OrbitWindow.PLACEMENT { length = Marshal.SizeOf<OrbitWindow.PLACEMENT>() }; if (!OrbitWindow.GetWindowPlacement(a.Window, ref p)) throw new Win32Exception(); expanded[a.Id] = p; OrbitWindow.ShowWindow(a.Window, 9); OrbitWindow.SetWindowPos(a.Window, 0, monitor.X, monitor.Y, monitor.Width, monitor.Height, 0x14); }
    }
    public void Restore(IEnumerable<Account> accounts)
    {
        foreach (var a in accounts) if (originals.Remove(a.Id, out var old) && a.Window == old.Handle && GameWindows.Owned(a))
        { OrbitWindow.Style(a.Window, old.Style); var p = old.Placement; OrbitWindow.SetWindowPlacement(a.Window, ref p); expanded.Remove(a.Id); }
    }
    public void Dispose() { originals.Clear(); expanded.Clear(); }
}
