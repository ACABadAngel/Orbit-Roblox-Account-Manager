using System.Diagnostics;
using System.Globalization;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Win32;
using Orbit.Core;
namespace Orbit.Desktop;
public partial class MainWindow
{
    private readonly LicenseService licensing;
    private string groupFilter="All groups",statusFilter="All statuses";
    private void SaveScreenshot(Account a)
    {if(!GameWindows.Owned(a)){Notify("Attach a running window first.");return;}var picker=new SaveFileDialog{Filter="PNG screenshot|*.png",FileName=a.Username+".png"};if(picker.ShowDialog(this)==true)_=Run(async ct=>{var handle=a.Window;var image=await Task.Run(()=>Capture(handle),ct);if(image is null||!GameWindows.Owned(a)||a.Window!=handle)throw new InvalidOperationException("The game window could not be captured.");var encoder=new System.Windows.Media.Imaging.PngBitmapEncoder();encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(image));using var file=File.Create(picker.FileName);encoder.Save(file);Notify("Screenshot saved.");});}
    private readonly Dictionary<string,int> serverCursors=[];
    private RemoteHost? remoteHost;
    private readonly List<Window> sessionWindows=[];
    private System.Windows.Forms.NotifyIcon? tray;
    private bool tickBusy,shuttingDown;
    private DateTimeOffset licenceChecked;
    private readonly CancellationTokenSource lifetime=new();
    private async Task InitializeFeatures()
    {
        try
        {
            var config=Path.Combine(AppContext.BaseDirectory,"services.json");
            if(File.Exists(config)&&store.State.License.AppName.Length==0&&store.State.License.Endpoint.Length==0)
            {
                using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(config));var root=doc.RootElement;
                if(root.TryGetProperty("provider",out var provider)&&provider.GetString()=="self-hosted"){store.State.License.Provider="self-hosted";store.State.License.Endpoint=root.GetProperty("serverUrl").GetString()??"";store.State.License.PublicKey=root.GetProperty("publicKey").GetString()??"";}
                if(root.TryGetProperty("keyauth",out var k)){store.State.License.AppName=k.GetProperty("name").GetString()??"";store.State.License.OwnerId=k.GetProperty("ownerid").GetString()??"";store.State.License.AppVersion=k.GetProperty("version").GetString()??"1.0";}
            }
            _=ProtocolPipe.Listen(uri=>Dispatcher.InvokeAsync(()=>HandleProtocol(uri)).Task.Unwrap(),lifetime.Token);
            tray=new System.Windows.Forms.NotifyIcon{Text="Orbit",Icon=System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!),Visible=true};
            tray.DoubleClick+=(_,_)=>Dispatcher.Invoke(()=>{Show();WindowState=WindowState.Normal;Activate();});
            var menu=new System.Windows.Forms.ContextMenuStrip();menu.Items.Add("Open Orbit",null,(_,_)=>Dispatcher.Invoke(()=>{Show();WindowState=WindowState.Normal;Activate();}));menu.Items.Add("Stop all sessions",null,(_,_)=>Dispatcher.Invoke(StopAll));menu.Items.Add("Exit",null,(_,_)=>Dispatcher.Invoke(()=>{store.State.MinimizeToTray=false;Close();}));tray.ContextMenuStrip=menu;
            StateChanged+=(_,_)=>{if(WindowState==WindowState.Minimized&&store.State.MinimizeToTray)Hide();};
            await licensing.Refresh(lifetime.Token);
            if(store.State.Host.Enabled)await RestartHost();
            if(store.State.CheckUpdates)_=CheckForUpdates(false);
        }
        catch(Exception e)when(e is not OutOfMemoryException){Notify("Startup service: "+e.Message);}
    }
    private async Task ShutdownFeatures()
    {
        shuttingDown=true;lifetime.Cancel();ReleaseRemoteInput();inputWatchdog.Stop();foreach(var w in sessionWindows.ToArray())w.Close();
        if(remoteHost is not null)await remoteHost.DisposeAsync();tray?.Dispose();
    }
    private void ScheduleRecovery(Account a)
    {
        var o=store.State.OptionsFor(a);if(a.StopRequested||!a.AutoRelaunch||!o.AutoRelaunch)return;
        while(a.RecoveryAttempts.TryPeek(out var t)&&DateTimeOffset.UtcNow-t>TimeSpan.FromMinutes(10))a.RecoveryAttempts.Dequeue();
        if(a.RecoveryAttempts.Count>=3){a.Error="Auto-relaunch paused after three attempts in ten minutes.";return;}
        a.RecoverAt=DateTimeOffset.UtcNow.AddSeconds(o.RecoveryDelaySeconds);a.Status="Recovery scheduled";
    }
    private async Task TickFeatures()
    {
        if(tickBusy||shuttingDown)return;tickBusy=true;
        try
        {
            if(DateTimeOffset.UtcNow-licenceChecked>TimeSpan.FromSeconds(30)){licenceChecked=DateTimeOffset.UtcNow;await licensing.Refresh(lifetime.Token);}
            if(operation is not null)return;
            var now=DateTimeOffset.UtcNow;
            foreach(var item in store.State.Schedules.Where(s=>s.State=="pending"&&s.At<=now).ToArray())
            {
                if(item.At is null)continue;
                if(now-item.At>TimeSpan.FromMinutes(5)){item.State="missed";store.Log("Missed schedule: "+item.Name);}
                else
                {
                    item.State="running";await store.SaveAsync();
                    try{await RunAutomation(item,lifetime.Token);item.State="completed";}
                    catch(Exception ex){item.State="failed";store.Log("Schedule failed: "+item.Name+" · "+ex.Message);}
                }
                var next=Automation.Next(item.At.Value,item.Repeat,now);if(next is not null){item.At=next;item.State="pending";}await store.SaveAsync();
            }
            if(operation is null&&accounts.FirstOrDefault(a=>a.RecoverAt<=now&&!a.StopRequested)is{} a)
            {a.RecoverAt=null;a.RecoveryAttempts.Enqueue(now);await Run(ct=>LaunchAccounts([a],ct,recovery:true));}
        }
        catch(OperationCanceledException){}
        catch(Exception e){Notify("Background task: "+e.Message);}
        finally{tickBusy=false;}
    }
    private readonly Dictionary<int,(TimeSpan Cpu,DateTime At)> metricSamples=[];
    private void UpdateMetrics(Account a)
    {
        if(!GameWindows.Owned(a))return;
        try
        {using var p=Process.GetProcessById(a.ProcessId);var cpu=p.TotalProcessorTime;var now=DateTime.UtcNow;var usage=metricSamples.TryGetValue(p.Id,out var old)?Math.Clamp((cpu-old.Cpu).TotalMilliseconds/Math.Max(1,(now-old.At).TotalMilliseconds)/Environment.ProcessorCount*100,0,100):0;metricSamples[p.Id]=(cpu,now);a.Resources=$"PID {p.Id} · {p.PrivateMemorySize64/1048576d:N0} MB · {usage:N1}% CPU";}
        catch(Exception e)when(e is ArgumentException or System.ComponentModel.Win32Exception or InvalidOperationException){}
    }
    private void StopAll()
    {operation?.Cancel();foreach(var a in accounts){a.StopRequested=true;a.RecoverAt=null;GameWindows.Stop(a);}Notify("Launch queue cancelled and managed local sessions stopped.");}
    private async Task RunAutomation(Automation item,CancellationToken ct)
    {
        item.Validate();if(item.Repeat!="once")licensing.Require("advancedSchedules");
        var selected=item.AccountIds.Select(id=>accounts.FirstOrDefault(a=>a.Id==id)).Where(a=>a is not null).Cast<Account>().ToArray();
        if(selected.Length!=item.AccountIds.Count)throw new InvalidOperationException("This automation references a removed account. Edit it first.");
        if(item.Action=="stop"){foreach(var a in selected){a.StopRequested=true;a.RecoverAt=null;GameWindows.Stop(a);}}
        else{if(operation is not null)throw new InvalidOperationException("Launch queue is busy.");await ExecuteOperation(token=>LaunchAccounts(selected,token),ct);}
        await SaveAsync("Automation: "+item.Name);
    }
    private void AutomationClick(object sender,RoutedEventArgs e)=>ShowAutomation();
    private void DeleteAutomation(Automation item,bool schedule)=>_=Run(async _=>{(schedule?store.State.Schedules:store.State.Workflows).Remove(item);await SaveAsync("Automation removed.");ShowAutomation();});
    private void EditAutomation(Automation? item,bool schedule)
    {
        var dialog=new FormDialog(this,schedule?"Schedule accounts":"Saved workflow");var name=dialog.Text("Name",item?.Name??"My session");var action=dialog.Choose("Action",new[]{"launch","stop"},item?.Action??"launch");
        var list=dialog.Multiple("Accounts",accounts,item?.AccountIds??Selected().Select(a=>a.Id).ToList(),a=>a.Id,"Label");
        var at=schedule?dialog.Text("Local date and time",(item?.At?.LocalDateTime??DateTime.Now.AddHours(1)).ToString("yyyy-MM-dd HH:mm")):null;
        var repeat=schedule?dialog.Choose("Repeat",new[]{"once","daily","weekly"},item?.Repeat??"once"):null;
        if(dialog.ShowDialog()!=true)return;
        _=Run(async _=>
        {
            var next=new Automation{Id=item?.Id??Guid.NewGuid().ToString(),Name=name.Text.Trim(),Action=(string)action.SelectedItem,AccountIds=list.SelectedItems.Cast<Account>().Select(a=>a.Id).ToList(),Repeat=repeat?.SelectedItem as string??"once"};
            if(schedule){if(!DateTime.TryParseExact(at!.Text,"yyyy-MM-dd HH:mm",CultureInfo.InvariantCulture,DateTimeStyles.None,out var time)||time<=DateTime.Now)throw new ArgumentException("Choose a future local date/time in yyyy-MM-dd HH:mm format.");next.At=new DateTimeOffset(time);if(next.Repeat!="once")licensing.Require("advancedSchedules");}else licensing.Require("workflows");
            next.Validate();var collection=schedule?store.State.Schedules:store.State.Workflows;if(item is null)collection.Add(next);else collection[collection.IndexOf(item)]=next;await SaveAsync("Automation saved.");ShowAutomation();
        });
    }
    private void BackupExport()=>BackupDialog(false);
    private void BackupImport()=>BackupDialog(true);
    private void BackupDialog(bool import)
    {
        var form=new FormDialog(this,import?"Restore encrypted backup":"Export encrypted backup","Use a passphrase of at least 12 characters. Backups contain account sessions. Machine pairing tokens and licences are excluded.");var password=form.Password("Backup passphrase");if(form.ShowDialog()!=true){form.ClearSecrets();return;}var pass=password.Password;form.ClearSecrets();
        if(import)
        {
            var chooser=new OpenFileDialog{Filter="Encrypted Orbit backup|*.orbit"};if(chooser.ShowDialog(this)!=true)return;
            _=Run(async ct=>{if(new FileInfo(chooser.FileName).Length>50_000_000)throw new InvalidDataException("Backup exceeds 50 MB.");var data=await Task.Run(()=>BackupService.Decrypt(File.ReadAllText(chooser.FileName),pass),ct);var count=BackupService.Merge(store,data);accounts.Clear();foreach(var a in store.State.Accounts)accounts.Add(a);await SaveAsync($"Backup merged: {count} new accounts. Existing accounts kept.");ShowAccounts();});
        }
        else
        {var chooser=new SaveFileDialog{Filter="Encrypted Orbit backup|*.orbit",FileName="orbit-backup.orbit"};if(chooser.ShowDialog(this)==true)_=Run(async ct=>{var payload=BackupService.Export(store);var encrypted=await Task.Run(()=>BackupService.Encrypt(payload,pass),ct);await File.WriteAllTextAsync(chooser.FileName,encrypted,ct);Notify("Encrypted backup exported.");});}
    }
    private void GroupSettings()
    {
        var form=new FormDialog(this,"Group launch rules");var group=form.Choose("Group",store.State.Groups,store.State.Groups.FirstOrDefault()??"Main");
        if(form.ShowDialog()!=true)return;var name=(string)group.SelectedItem;var o=store.State.GroupSettings.GetValueOrDefault(name)??new();
        var dialog=new FormDialog(this,"Launch rules · "+name);var profile=dialog.Choose("Launch profile",store.State.Profiles,store.State.Profiles.FirstOrDefault(p=>p.Id==o.ProfileId)??store.State.Profiles[0]);var delay=dialog.Text("Seconds between launches",o.DelaySeconds.ToString());var recovery=dialog.Toggle("Automatically relaunch unexpected disconnects",o.AutoRelaunch);var recoveryDelay=dialog.Text("Recovery delay (seconds)",o.RecoveryDelaySeconds.ToString());var mode=dialog.Choose("Private-server mode",new[]{"none","assigned","round-robin"},o.ServerMode);var servers=dialog.Multiple("Round-robin server pool",store.State.PrivateServers,o.ServerIds,s=>s.Id,"Name");
        if(dialog.ShowDialog()==true)_=Run(async _=>{if(!int.TryParse(delay.Text,out var d)||d is <0 or >120||!int.TryParse(recoveryDelay.Text,out var r)||r is <5 or >300)throw new ArgumentException("Launch delay: 0–120 seconds; recovery delay: 5–300 seconds.");store.State.GroupSettings[name]=new(){ProfileId=((LaunchProfile)profile.SelectedItem).Id,DelaySeconds=d,AutoRelaunch=recovery.IsChecked==true,RecoveryDelaySeconds=r,ServerMode=(string)mode.SelectedItem,ServerIds=servers.SelectedItems.Cast<PrivateServer>().Select(s=>s.Id).ToList()};await SaveAsync("Group rules saved.");});
    }
    private void PrivateServersPage()
    {
        var panel=new StackPanel();panel.Children.Add(Button("Add private server",()=>EditServer(null)));foreach(var s in store.State.PrivateServers){var item=s;panel.Children.Add(Card(Actions(Button(item.Name+" · "+item.PlaceId,()=>EditServer(item)),Button("Remove",()=>_=Run(async _=>{store.State.PrivateServers.Remove(item);await SaveAsync("Private server removed.");PrivateServersPage();})))));}Navigate("Private servers","Access codes and invites stay in your protected workspace.",Scroll(panel));
    }
    private void EditServer(PrivateServer? server)
    {
        var form=new FormDialog(this,"Private server");var name=form.Text("Name",server?.Name??"");var place=form.Text("Place ID",server?.PlaceId??"");var target=form.Text("Private invite or access code",server?.Target??"");
        if(form.ShowDialog()==true)_=Run(async _=>{LaunchUri.ValidateProfile(new(){PlaceId=place.Text});if(!System.Text.RegularExpressions.Regex.IsMatch(target.Text,@"^[a-zA-Z0-9_-]{8,256}$"))PrivateServers.ValidateLink(target.Text,place.Text);if(name.Text.Length is <1 or >80)throw new ArgumentException("Enter a server name.");var value=new PrivateServer{Id=server?.Id??Guid.NewGuid().ToString(),Name=name.Text,PlaceId=place.Text,Target=target.Text};if(server is null)store.State.PrivateServers.Add(value);else store.State.PrivateServers[store.State.PrivateServers.IndexOf(server)]=value;await SaveAsync("Private server saved.");PrivateServersPage();});
    }
    private void ConfigureLicence()
    {
        var o=store.State.License;var form=new FormDialog(this,"Licence service","Use public application configuration only. Never enter a seller/admin secret.");var provider=form.Choose("Provider",new[]{"keyauth","self-hosted"},o.Provider);var name=form.Text("KeyAuth application name",o.AppName);var owner=form.Text("KeyAuth Owner ID",o.OwnerId);var version=form.Text("KeyAuth version",o.AppVersion);var endpoint=form.Text("Self-hosted service origin",o.Endpoint);var publicKey=form.Text("Self-hosted public verification key",o.PublicKey,true);
        if(form.ShowDialog()==true)_=Run(async _=>{licensing.Clear();o.Provider=(string)provider.SelectedItem;o.AppName=name.Text;o.OwnerId=owner.Text;o.AppVersion=version.Text;if(o.Provider=="self-hosted")LicenseService.ServiceOrigin(endpoint.Text);o.Endpoint=endpoint.Text;o.PublicKey=publicKey.Text;await SaveAsync("Licence configuration saved. Activate a key to verify it.");LicensePage();});
    }
    private void CommandPalette()
    {
        var commands=new Dictionary<string,Action>{{"Accounts",ShowAccounts},{"Roblox launcher",ShowLauncher},{"Live view",()=>LiveClick(this,new())},{"Layouts",()=>LayoutsClick(this,new())},{"Machines",()=>MachinesClick(this,new())},{"Automation",ShowAutomation},{"Audio",()=>AudioClick(this,new())},{"Settings",()=>SettingsClick(this,new())},{"Stop all",StopAll},{"Sign in",SignIn},{"Account & Licence",LicensePage},{"Export backup",BackupExport},{"Floating monitor",()=>{var monitor=new MonitorWindow(this,accounts);sessionWindows.Add(monitor);monitor.Closed+=(_,_)=>sessionWindows.Remove(monitor);monitor.Show();}}};
        var dialog=new Window{Owner=this,Title="Orbit commands",Width=560,Height=480,WindowStartupLocation=WindowStartupLocation.CenterOwner};var panel=new DockPanel{Margin=new(20)};var filter=new TextBox();DockPanel.SetDock(filter,Dock.Top);panel.Children.Add(filter);var list=new ListBox{ItemsSource=commands.Keys.ToArray(),Background=new SolidColorBrush(Color.FromRgb(32,32,32)),Foreground=Brushes.White};panel.Children.Add(list);filter.TextChanged+=(_,_)=>list.ItemsSource=commands.Keys.Where(k=>k.Contains(filter.Text,StringComparison.OrdinalIgnoreCase)).ToArray();void Execute(){if(list.SelectedItem is string k){dialog.Close();commands[k]();}}list.MouseDoubleClick+=(_,_)=>Execute();dialog.KeyDown+=(_,e)=>{if(e.Key==Key.Escape)dialog.Close();if(e.Key==Key.Enter)Execute();};dialog.Content=panel;dialog.Loaded+=(_,_)=>filter.Focus();dialog.ShowDialog();
    }
}
