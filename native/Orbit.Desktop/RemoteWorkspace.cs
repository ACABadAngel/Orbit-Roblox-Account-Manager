using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Orbit.Core;
namespace Orbit.Desktop;
public partial class MainWindow
{
    private readonly ControlLease controlLease=new();private readonly HashSet<int> heldKeys=[];private readonly HashSet<int> heldButtons=[];
    private readonly DispatcherTimer inputWatchdog=new(){Interval=TimeSpan.FromMilliseconds(150)};
    private Account? controlled;
    private async Task RestartHost()
    {
        ReleaseRemoteInput();if(remoteHost is not null){await remoteHost.DisposeAsync();remoteHost=null;}
        if(store.State.Host.Enabled){remoteHost=new(this,store);await remoteHost.Start();}
        inputWatchdog.Tick-=InputWatchdog;inputWatchdog.Tick+=InputWatchdog;inputWatchdog.Start();
    }
    private void InputWatchdog(object? sender,EventArgs e)
    {if(!controlLease.Active||!store.State.Host.AllowInput||controlled is not null&&!GameWindows.Owned(controlled))ReleaseRemoteInput();}
    private void ReleaseRemoteInput()
    {
        foreach(var key in heldKeys.ToArray())try{OrbitWindow.Key(key,true);}catch(System.ComponentModel.Win32Exception){}catch(InvalidOperationException){}
        foreach(var button in heldButtons.ToArray())try{OrbitWindow.Mouse(button==0?4u:button==1?16u:64u,0,0,0);}catch(InvalidOperationException){}
        heldKeys.Clear();heldButtons.Clear();controlLease.Release();controlled=null;
    }
    internal MachineSnapshot RemoteSnapshot()=>new(Environment.MachineName,accounts.Select(a=>new RemoteAccount(a.Id,a.Label,a.Status,GameWindows.Owned(a))).ToArray(),store.State.Host.AllowInput,store.State.Host.StreamFps,store.State.Host.StreamHeight);
    internal nint RemoteCaptureHandle(string id)
    {var account=accounts.FirstOrDefault(a=>a.Id==id)??throw new ArgumentException("Account not found.");if(!GameWindows.Owned(account))throw new InvalidOperationException("Game window is no longer attached.");return account.Window;}
    internal async Task<object> RemoteAction(RemoteCommand command,CancellationToken ct)
    {
        if(command.Action=="release"){if(controlLease.Accept(command.AccountId,command.Lease))ReleaseRemoteInput();return new{ok=true};}
        var account=accounts.FirstOrDefault(a=>a.Id==command.AccountId)??throw new ArgumentException("Account not found.");
        if(command.Action=="launch"){await ExecuteOperation(token=>LaunchAccounts([account],token),ct);return new{ok=true};}
        if(command.Action=="stop"){operation?.Cancel();account.StopRequested=true;account.RecoverAt=null;GameWindows.Stop(account);if(controlled==account)ReleaseRemoteInput();return new{ok=true};}
        if(command.Action=="audio"){if(!double.IsFinite(command.Volume)||command.Volume is <0 or >1)throw new ArgumentException("Invalid volume.");account.Volume=command.Volume;account.Muted=command.Muted;ApplyAudio(account);await store.SaveAsync();return new{ok=true};}
        if(!store.State.Host.AllowInput||!GameWindows.Owned(account)){ReleaseRemoteInput();throw new InvalidOperationException("Enable remote input and attach a running Roblox window on the host.");}
        if(command.Action=="acquire")
        {if(!controlLease.Active)ReleaseRemoteInput();var token=controlLease.Acquire(account.Id);controlled=account;return new{lease=token};}
        if(!controlLease.Accept(account.Id,command.Lease))throw new InvalidOperationException("Input lease expired or belongs to another controller.");
        if(command.Action=="keepalive")return new{ok=true};
        if(!OrbitWindow.FocusGame(account.Window)){ReleaseRemoteInput();throw new InvalidOperationException("The host could not focus the game. Match Roblox and Orbit permission levels.");}
        if(!double.IsFinite(command.X)||!double.IsFinite(command.Y))throw new ArgumentException("Invalid input coordinates.");
        switch(command.Action)
        {
            case "key":if(command.Key is <1 or >254)throw new ArgumentException("Invalid key.");OrbitWindow.Key(command.Key,command.Up);if(command.Up)heldKeys.Remove(command.Key);else heldKeys.Add(command.Key);break;
            case "move":
                if(command.X is <0 or >1||command.Y is <0 or >1)throw new ArgumentException("Input is outside the video.");OrbitWindow.GetClientRect(account.Window,out var r);var point=new OrbitWindow.POINT();OrbitWindow.ClientToScreen(account.Window,ref point);OrbitWindow.SetCursorPos(point.X+(int)(command.X*Math.Max(0,r.Right-1)),point.Y+(int)(command.Y*Math.Max(0,r.Bottom-1)));break;
            case "relative":if(Math.Abs(command.X)>2048||Math.Abs(command.Y)>2048)throw new ArgumentException("Relative move too large.");OrbitWindow.Mouse(1,(int)command.X,(int)command.Y,0);break;
            case "button":if(command.Key is <0 or >2)throw new ArgumentException("Invalid button.");OrbitWindow.Mouse(command.Key==0?(command.Up?4u:2u):command.Key==1?(command.Up?16u:8u):(command.Up?64u:32u),0,0,0);if(command.Up)heldButtons.Remove(command.Key);else heldButtons.Add(command.Key);break;
            case "wheel":OrbitWindow.Mouse(0x800,0,0,Math.Clamp(command.Key,-1200,1200));break;
            default:throw new ArgumentException("Unknown remote action.");
        }
        return new{ok=true};
    }
    private void MachinesClick(object sender,RoutedEventArgs e)
    {
        var panel=new StackPanel();panel.Children.Add(Actions(Button("Pair PC",PairMachine),Button("Host settings",HostSettings),Button("Pairing details",PairingDetails),Button("Rotate host token",()=>_=Run(async _=>{store.State.Host.Token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));await RestartHost();await SaveAsync("Host token rotated. Existing controllers must pair again.");})),Button("Launch across PCs",()=>_=Run(async ct=>{licensing.Require("crossMachineBulk");foreach(var machine in store.State.Machines){RequireMachine(machine);using var client=new MachineClient(machine);var state=await client.State(ct);foreach(var a in state.Accounts.Where(a=>!a.Running))await client.Command(new("launch",a.Id),ct);}await SaveAsync("Cross-PC launch completed.");}))));
        foreach(var peer in store.State.Machines)
        {
            var machine=peer;panel.Children.Add(Text(machine.Name,22));panel.Children.Add(Text(machine.Address,12,true));panel.Children.Add(Actions(Button("Open accounts",()=>_=Run(async ct=>{RequireMachine(machine);using var client=new MachineClient(machine);var snapshot=await client.State(ct);ShowMachine(machine,snapshot);})),Button("Unpair",()=>_=Run(async _=>{store.State.Machines.Remove(machine);await SaveAsync("Machine unpaired.");MachinesClick(this,new());}))));
        }
        panel.Children.Add(Text("Use native Orbit on both PCs over LAN or a private VPN. Hosting is off by default. Certificates are trusted only by their exact SHA-256 fingerprint. Remote input requires permission on the host and a single active control lease.",14,true));
        Navigate("Machines","Your accounts and launcher, across your own PCs.",Scroll(panel));
    }
    private void RequireMachine(PairedMachine machine)
    {licensing.Require("remoteControl");var index=store.State.Machines.FindIndex(p=>p.Id==machine.Id);if(index<0||index>=licensing.Status.Devices)throw new InvalidOperationException("This PC exceeds your licence’s managed-device allowance.");}
    private void PairMachine()
    {
        var form=new FormDialog(this,"Pair your PC","Copy these details from the host’s Host settings. The fingerprint is checked during TLS before the token is sent.");var name=form.Text("Name","My PC");var address=form.Text("HTTPS address","https://192.168.1.20:43129");var fingerprint=form.Text("SHA-256 fingerprint","");var token=form.Password("Pairing token");
        if(form.ShowDialog()!=true){form.ClearSecrets();return;}var secret=token.Password;form.ClearSecrets();_=Run(async ct=>{licensing.Require("remoteControl");if(store.State.Machines.Count>=licensing.Status.Devices)throw new InvalidOperationException("Managed PC limit reached.");RemoteSecurity.Address(address.Text);var pin=RemoteSecurity.Fingerprint(fingerprint.Text);if(secret.Length!=64)throw new ArgumentException("Copy the complete pairing token.");var peer=new PairedMachine{Name=name.Text,Address=address.Text,Fingerprint=pin,Token=secret};using var client=new MachineClient(peer);var state=await client.State(ct);store.State.Machines.Add(peer);await SaveAsync("Machine paired: "+peer.Name);ShowMachine(peer,state);});
    }
    private void ShowMachine(PairedMachine peer,MachineSnapshot state)
    {
        var panel=new StackPanel();panel.Children.Add(Text(state.Name,24));
        foreach(var remote in state.Accounts)
        {
            var account=remote;panel.Children.Add(Text(account.Label+" · "+account.Status,18));panel.Children.Add(Actions(Button("Remote Play",()=>{try{RequireMachine(peer);var player=new RemotePlayer(this,peer,account,()=>RequireMachine(peer));sessionWindows.Add(player);player.Closed+=(_,_)=>sessionWindows.Remove(player);player.Show();}catch(Exception ex){Notify(ex.Message);}}),Button("Launch",()=>_=Run(async ct=>{RequireMachine(peer);using var client=new MachineClient(peer);await client.Command(new("launch",account.Id),ct);Notify("Remote launch completed.");})),Button("Stop",()=>_=Run(async ct=>{using var client=new MachineClient(peer);await client.Command(new("stop",account.Id),ct);Notify("Remote session stopped.");})),Button("Volume",()=>{var form=new FormDialog(this,"Remote audio");var volume=form.Text("Volume (0–100)","50");var mute=form.Toggle("Mute",false);if(form.ShowDialog()==true)_=Run(async ct=>{RequireMachine(peer);if(!double.TryParse(volume.Text,out var v)||v is <0 or >100)throw new ArgumentException("Choose 0–100.");using var client=new MachineClient(peer);await client.Command(new("audio",account.Id,Volume:v/100,Muted:mute.IsChecked==true),ct);});})));
        }
        Navigate(peer.Name,"Remote accounts are read from the paired host, never sample data.",Scroll(panel));
    }
    private void HostSettings()
    {
        var o=store.State.Host;var form=new FormDialog(this,"Machine hosting","Allow Orbit through Windows Firewall on your private network. Native hosts default to port 43129 so they can coexist with the old app on 43128.");var enabled=form.Toggle("Enable encrypted machine host",o.Enabled);var lan=form.Toggle("Listen on LAN / VPN (otherwise this PC only)",o.Lan);var input=form.Toggle("Allow remote keyboard and mouse control",o.AllowInput);var port=form.Text("Port",o.Port.ToString());var fps=form.Choose("Stream FPS target",new[]{30,60},o.StreamFps);var height=form.Choose("Maximum video height",new[]{480,720,1080},o.StreamHeight);
        if(form.ShowDialog()==true)_=Run(async _=>{if(!int.TryParse(port.Text,out var p)||p is <1024 or >65535)throw new ArgumentException("Use a port from 1024 to 65535.");o.Enabled=enabled.IsChecked==true;o.Lan=lan.IsChecked==true;o.AllowInput=input.IsChecked==true;o.Port=p;o.StreamFps=(int)fps.SelectedItem;o.StreamHeight=(int)height.SelectedItem;await RestartHost();await SaveAsync("Host settings saved.");if(remoteHost is not null)PairingDetails();});
    }
    private void PairingDetails()
    {
        if(remoteHost is null)return;var dialog=new FormDialog(this,"Pairing details","Keep the token private. Rotating it disconnects every existing controller.");dialog.Text("Host port",store.State.Host.Port.ToString());dialog.Text("SHA-256 fingerprint",remoteHost.Fingerprint);dialog.Text("Pairing token",store.State.Host.Token);if(dialog.ShowDialog()==true)Notify("Use this PC’s LAN/VPN IP address with the port shown.");
    }
}
