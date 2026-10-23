using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Effects;
using Orbit.Core;
namespace Orbit.Desktop;
public partial class MainWindow
{
    private bool updateChecking;
    private async Task CheckForUpdates(bool manual)
    {
        if(updateChecking)return;updateChecking=true;
        try
        {
            using var client=new HttpClient{Timeout=TimeSpan.FromSeconds(20)};var offer=await NativeUpdate.Check(client,Assembly.GetExecutingAssembly().GetName().Version??new Version(0,6,0),store.State.UpdateChannel,lifetime.Token);
            if(offer is null){if(manual)Notify("No newer native Orbit release is available. Development artifacts are not installed automatically.");return;}
            var dialog=new Window{Owner=this,Title="Orbit update",Width=420,SizeToContent=SizeToContent.Height,ResizeMode=ResizeMode.NoResize,WindowStartupLocation=WindowStartupLocation.CenterOwner};var panel=new StackPanel{Margin=new(28)};panel.Children.Add(Text("New Orbit update",25));panel.Children.Add(Text("Version "+offer.Version+" is available.",14,true));var buttons=new WrapPanel();var later=new Button{Content="Not now",IsCancel=true};var update=new Button{Content="Update"};update.Click+=(_,_)=>dialog.DialogResult=true;buttons.Children.Add(later);buttons.Children.Add(update);panel.Children.Add(buttons);dialog.Content=panel;var content=Content as System.Windows.UIElement;if(content is not null)content.Effect=new BlurEffect{Radius=12};bool accept;try{accept=dialog.ShowDialog()==true;}finally{if(content is not null)content.Effect=null;}
            if(!accept)return;
            await Run(async ct=>
            {
                GuardNoGames();if(sessionWindows.Count>0)throw new InvalidOperationException("Close play windows before updating Orbit.");var executable=Environment.ProcessPath!;if(Path.GetFileName(executable).Equals("dotnet.exe",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Run a packaged native build to install updates.");
                Notify("Downloading Orbit update…");var temporary=Path.Combine(Path.GetTempPath(),"Orbit-Update-"+Guid.NewGuid());using var download=new HttpClient{Timeout=TimeSpan.FromMinutes(10)};var zip=await NativeUpdate.Download(download,offer,temporary,ct);GuardNoGames();
                var helper=Path.Combine(temporary,"Orbit.Native.exe");File.Copy(executable,helper);var marker=Path.Combine(AppContext.BaseDirectory,".orbit-native-install");if(!File.Exists(marker))File.WriteAllText(marker,"Orbit per-user/portable installation");
                var start=new ProcessStartInfo(helper){UseShellExecute=false};foreach(var argument in new[]{"--apply-update",zip,AppContext.BaseDirectory,Environment.ProcessId.ToString()})start.ArgumentList.Add(argument);Process.Start(start)?.Dispose();
                _=Dispatcher.BeginInvoke(new Action(()=>Close()));
            });
        }
        catch(Exception e)when(e is not OutOfMemoryException){if(manual)Notify("Update check: "+e.Message);}
        finally{updateChecking=false;}
    }
}
internal static class UpdateApplier
{
    public static async Task Apply(string zip,string destination,int pid)
    {
        if(!File.Exists(Path.Combine(destination,".orbit-native-install"))||!File.Exists(Path.Combine(destination,"Orbit.Native.exe")))throw new InvalidDataException("Target is not an Orbit installation.");
        try{using var previous=Process.GetProcessById(pid);using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(60));await previous.WaitForExitAsync(timeout.Token);}catch(ArgumentException){}
        var stage=Path.Combine(Path.GetTempPath(),"Orbit-Install-"+Guid.NewGuid());Directory.CreateDirectory(stage);
        try
        {
            using var archive=ZipFile.OpenRead(zip);if(archive.Entries.Count>2000||archive.Entries.Sum(e=>e.Length)>1_500_000_000)throw new InvalidDataException("Invalid update archive.");
            foreach(var entry in archive.Entries){var path=Deployment.SafePath(stage,entry.FullName);if(((entry.ExternalAttributes>>16)&0xF000)==0xA000)throw new InvalidDataException("Update links are forbidden.");if(entry.FullName.EndsWith('/')){Directory.CreateDirectory(path);continue;}Directory.CreateDirectory(Path.GetDirectoryName(path)!);entry.ExtractToFile(path,true);}
            if(!File.Exists(Path.Combine(stage,"Orbit.Native.exe")))throw new InvalidDataException("Update is missing Orbit.");
            var rollback=Path.Combine(destination,".previous");Directory.CreateDirectory(rollback);var changed=new List<(string Target,string Backup,bool HadOld)>();
            try
            {
                foreach(var source in Directory.GetFiles(stage,"*",SearchOption.AllDirectories))
                {var relative=Path.GetRelativePath(stage,source);var target=Deployment.SafePath(destination,relative);var backup=Deployment.SafePath(rollback,relative);var exists=File.Exists(target);Directory.CreateDirectory(Path.GetDirectoryName(target)!);Directory.CreateDirectory(Path.GetDirectoryName(backup)!);if(exists)File.Copy(target,backup,true);changed.Add((target,backup,exists));File.Copy(source,target,true);}
            }
            catch{foreach(var item in changed.AsEnumerable().Reverse()){if(item.HadOld)File.Copy(item.Backup,item.Target,true);else if(File.Exists(item.Target))File.Delete(item.Target);}throw;}
            Process.Start(new ProcessStartInfo(Path.Combine(destination,"Orbit.Native.exe")){UseShellExecute=false,WorkingDirectory=destination})?.Dispose();
        }
        finally{Directory.Delete(stage,true);}
    }
}
