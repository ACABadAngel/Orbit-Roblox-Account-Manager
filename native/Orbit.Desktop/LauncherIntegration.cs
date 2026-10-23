using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
using Microsoft.Win32;
using Orbit.Core;
namespace Orbit.Desktop;
public static class ProtocolIntegration
{
    private const string KeyPath=@"Software\Classes\roblox-player\shell\open\command";
    public static bool IsOrbit()=>Registry.CurrentUser.OpenSubKey(KeyPath)?.GetValue(null)?.ToString()?.Contains(Environment.ProcessPath!,StringComparison.OrdinalIgnoreCase)==true;
    public static void Register(string backupPath)
    {
        var exe=Environment.ProcessPath??throw new InvalidOperationException("Orbit path is unavailable.");if(Path.GetFileName(exe).Equals("dotnet.exe",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Install or publish Orbit before registering its launcher.");
        using var existing=Registry.CurrentUser.OpenSubKey(KeyPath);var old=existing?.GetValue(null)as string;if(!File.Exists(backupPath))File.WriteAllText(backupPath,JsonSerializer.Serialize(old));
        using var root=Registry.CurrentUser.CreateSubKey(@"Software\Classes\roblox-player");root.SetValue(null,"Roblox via Orbit");root.SetValue("URL Protocol","");using var command=Registry.CurrentUser.CreateSubKey(KeyPath);command.SetValue(null,$"\"{exe}\" --roblox \"%1\"");
    }
    public static void Restore(string backupPath)
    {
        if(!IsOrbit())throw new InvalidOperationException("Another launcher owns this handler. Orbit will not overwrite it.");
        var previous=File.Exists(backupPath)?JsonSerializer.Deserialize<string>(File.ReadAllText(backupPath)):null;
        if(previous is null)Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\roblox-player",false);else{using var command=Registry.CurrentUser.CreateSubKey(KeyPath);command.SetValue(null,previous);}if(File.Exists(backupPath))File.Delete(backupPath);
    }
    public static string ValidateLaunch(string input)
    {
        if(input.Length>20000||input.Any(c=>c<' '||c=='"')||!input.StartsWith("roblox-player:",StringComparison.OrdinalIgnoreCase))throw new ArgumentException("Invalid Roblox launch URI.");return input;
    }
}
public partial class MainWindow
{
    private void ProtocolSettings()
    {
        var panel=new StackPanel();panel.Children.Add(Text(ProtocolIntegration.IsOrbit()?"Orbit handles Roblox launches":"Use Orbit as your Roblox launcher",24));panel.Children.Add(Text("Registering changes the current Windows user’s roblox-player URL handler. The previous command is saved and can be restored. Your existing Roblox/Froststrap installation is kept.",14,true));var backup=Path.Combine(store.DirectoryPath,"previous-protocol.json");
        panel.Children.Add(Actions(Button("Register Orbit",()=>_=Run(_=>{ProtocolIntegration.Register(backup);Notify("Orbit registered for Roblox links.");return Task.CompletedTask;})),Button("Restore previous launcher",()=>_=Run(_=>{ProtocolIntegration.Restore(backup);Notify("Previous launcher restored.");return Task.CompletedTask;})),Button("Create desktop shortcut",()=>_=Run(_=>{var desktop=Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);var path=Path.Combine(desktop,"Orbit.url");File.WriteAllText(path,"[InternetShortcut]\r\nURL=file:///"+Environment.ProcessPath!.Replace('\\','/')+"\r\nIconFile="+Environment.ProcessPath+"\r\nIconIndex=0\r\n");Notify("Orbit shortcut created.");return Task.CompletedTask;}))));Navigate("Launcher integration","Roblox links, with a reversible Windows registration.",panel);
    }
    internal async Task HandleProtocol(string uri)
    {await Run(async ct=>{var valid=ProtocolIntegration.ValidateLaunch(uri);var client=await EnsureClient(ct);await ClientCustomization.ApplyFlagsAsync(client,store.State.Launcher.FastFlags,null,ct);var start=new ProcessStartInfo(client.Executable){UseShellExecute=false,WorkingDirectory=client.Directory};start.ArgumentList.Add(valid);Process.Start(start)?.Dispose();Notify("Roblox launch handed to the managed client.");});}
    private void OpenLocalPlay(Account a)
    {
        if(!GameWindows.Owned(a)){Notify("Attach a running game window first.");return;}
        var player=new LocalPlayer(this,a);sessionWindows.Add(player);player.Closed+=(_,_)=>sessionWindows.Remove(player);player.Show();
    }
}
public sealed class LocalPlayer : Window
{
    private readonly Account account;private readonly Border area=new(){Background=System.Windows.Media.Brushes.Black};private readonly DispatcherTimer follow=new(){Interval=TimeSpan.FromMilliseconds(100)};private OrbitWindow.PLACEMENT placement;private int style;private nint previousOwner;private bool restored;
    public LocalPlayer(Window owner,Account account)
    {
        this.account=account;Owner=owner;Title=account.Label+" · Orbit Local Play";Width=1100;Height=760;WindowStartupLocation=WindowStartupLocation.CenterOwner;
        placement=new(){length=System.Runtime.InteropServices.Marshal.SizeOf<OrbitWindow.PLACEMENT>()};OrbitWindow.GetWindowPlacement(account.Window,ref placement);style=OrbitWindow.GetWindowLong(account.Window,-16);previousOwner=OrbitWindow.Owner(account.Window);
        var panel=new DockPanel();var back=new Button{Content="Return to separate window · Ctrl+Shift+Backspace",Margin=new(12)};back.Click+=(_,_)=>Close();DockPanel.SetDock(back,Dock.Top);panel.Children.Add(back);panel.Children.Add(area);Content=panel;
        Loaded+=(_,_)=>{if(!GameWindows.Owned(account)){Close();return;}OrbitWindow.SetOwner(account.Window,new WindowInteropHelper(this).Handle);OrbitWindow.Style(account.Window,style&~0x00C40000);follow.Tick+=(_,_)=>Align();follow.Start();Align();};LocationChanged+=(_,_)=>Align();SizeChanged+=(_,_)=>Align();Closed+=(_,_)=>Restore();PreviewKeyDown+=(_,e)=>{if(e.Key==System.Windows.Input.Key.Back&&System.Windows.Input.Keyboard.Modifiers==(System.Windows.Input.ModifierKeys.Control|System.Windows.Input.ModifierKeys.Shift)){Close();e.Handled=true;}};
    }
    private void Align()
    {
        if(!IsLoaded||restored)return;if(!GameWindows.Owned(account)){Close();return;}
        if(System.Windows.Input.Keyboard.IsKeyDown(System.Windows.Input.Key.LeftCtrl)&&System.Windows.Input.Keyboard.IsKeyDown(System.Windows.Input.Key.LeftShift)&&System.Windows.Input.Keyboard.IsKeyDown(System.Windows.Input.Key.Back)){Close();return;}
        if(WindowState==WindowState.Minimized){OrbitWindow.ShowWindow(account.Window,6);return;}var top=area.PointToScreen(new(0,0));var bottom=area.PointToScreen(new(area.ActualWidth,area.ActualHeight));OrbitWindow.ShowWindow(account.Window,9);OrbitWindow.SetWindowPos(account.Window,0,(int)top.X,(int)top.Y,Math.Max(100,(int)(bottom.X-top.X)),Math.Max(100,(int)(bottom.Y-top.Y)),0x34);
    }
    private void Restore()
    {if(restored)return;restored=true;follow.Stop();if(GameWindows.Owned(account)){OrbitWindow.Style(account.Window,style);OrbitWindow.SetOwner(account.Window,previousOwner);OrbitWindow.SetWindowPlacement(account.Window,ref placement);}}
}
