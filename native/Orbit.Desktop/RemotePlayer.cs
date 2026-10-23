using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Orbit.Core;
namespace Orbit.Desktop;
public sealed class RemotePlayer : Window
{
    private readonly MachineClient client;private readonly RemoteAccount account;private readonly Action authorize;
    private readonly Image image=new(){Stretch=Stretch.Uniform,Focusable=true};private readonly TextBlock status=new(){Text="Connecting…",Margin=new(12)};
    private readonly CancellationTokenSource cancel=new();private readonly SemaphoreSlim input=new(1);private string lease="";private bool relative,closing;private long lastMove;private readonly DispatcherTimer heartbeat=new(){Interval=TimeSpan.FromSeconds(2)};
    public RemotePlayer(Window owner,PairedMachine peer,RemoteAccount account,Action authorize)
    {
        this.account=account;this.authorize=authorize;client=new(peer);Owner=owner;Title=$"{account.Label} · {peer.Name} · Orbit Remote Play";Width=1100;Height=760;WindowStartupLocation=WindowStartupLocation.CenterOwner;
        var panel=new DockPanel();var toolbar=new WrapPanel{Margin=new(12)};var take=new Button{Content="Take control"};take.Click+=async(_,_)=>{try{authorize();var r=await client.Command(new("acquire",account.Id),cancel.Token);lease=r.GetProperty("lease").GetString()!;status.Text="Control active · Escape releases input";image.Focus();heartbeat.Start();}catch(Exception e){status.Text=e.Message;}};toolbar.Children.Add(take);
        var camera=new Button{Content="Capture mouse"};camera.Click+=(_,_)=>{if(lease.Length==0)return;relative=true;Mouse.Capture(image);image.Cursor=Cursors.None;Recenter();image.Focus();};toolbar.Children.Add(camera);
        var release=new Button{Content="Release control"};release.Click+=async(_,_)=>await Release();toolbar.Children.Add(release);DockPanel.SetDock(toolbar,Dock.Top);panel.Children.Add(toolbar);DockPanel.SetDock(status,Dock.Bottom);panel.Children.Add(status);panel.Children.Add(image);Content=panel;
        Loaded+=async(_,_)=>await Receive();Closed+=async(_,_)=>{closing=true;await Release();cancel.Cancel();heartbeat.Stop();client.Dispose();};Deactivated+=async(_,_)=>await Release();
        PreviewKeyDown+=async(_,e)=>{if(e.Key==Key.Escape){await Release();e.Handled=true;return;}if(lease.Length==0)return;e.Handled=true;if(!e.IsRepeat)await Send(new("key",account.Id,Key:KeyInterop.VirtualKeyFromKey(e.Key==Key.System?e.SystemKey:e.Key)));};PreviewKeyUp+=async(_,e)=>{if(lease.Length>0){e.Handled=true;await Send(new("key",account.Id,Key:KeyInterop.VirtualKeyFromKey(e.Key==Key.System?e.SystemKey:e.Key),Up:true));}};
        image.MouseMove+=async(_,e)=>{if(lease.Length==0||Stopwatch.GetElapsedTime(lastMove).TotalMilliseconds<16)return;lastMove=Stopwatch.GetTimestamp();var p=e.GetPosition(image);if(relative){var dx=p.X-image.ActualWidth/2;var dy=p.Y-image.ActualHeight/2;if(Math.Abs(dx)+Math.Abs(dy)<1)return;Recenter();await Send(new("relative",account.Id,X:Math.Clamp(dx,-2048,2048),Y:Math.Clamp(dy,-2048,2048)));}else if(Position(p)is{} point)await Send(new("move",account.Id,X:point.X,Y:point.Y));};
        image.MouseDown+=async(_,e)=>{if(lease.Length==0)return;image.Focus();if(Position(e.GetPosition(image))is{} p){await Send(new("move",account.Id,X:p.X,Y:p.Y));await Send(new("button",account.Id,Key:e.ChangedButton==MouseButton.Left?0:e.ChangedButton==MouseButton.Right?1:2));}e.Handled=true;};image.MouseUp+=async(_,e)=>{if(lease.Length>0)await Send(new("button",account.Id,Key:e.ChangedButton==MouseButton.Left?0:e.ChangedButton==MouseButton.Right?1:2,Up:true));};image.MouseWheel+=async(_,e)=>{if(lease.Length>0){await Send(new("wheel",account.Id,Key:e.Delta));e.Handled=true;}};
        heartbeat.Tick+=async(_,_)=>{try{authorize();await Send(new("keepalive",account.Id));}catch(Exception){await Release();}};
    }
    private Point? Position(Point p)
    {
        if(image.Source is not BitmapSource bitmap)return null;var scale=Math.Min(image.ActualWidth/bitmap.PixelWidth,image.ActualHeight/bitmap.PixelHeight);var width=bitmap.PixelWidth*scale;var height=bitmap.PixelHeight*scale;var x=(p.X-(image.ActualWidth-width)/2)/width;var y=(p.Y-(image.ActualHeight-height)/2)/height;return x is >=0 and <=1&&y is >=0 and <=1?new Point(x,y):null;
    }
    private void Recenter(){var point=image.PointToScreen(new(image.ActualWidth/2,image.ActualHeight/2));OrbitWindow.SetCursorPos((int)point.X,(int)point.Y);}
    private async Task Send(RemoteCommand command)
    {
        if(lease.Length==0)return;await input.WaitAsync();try{authorize();if(lease.Length>0)await client.Command(command with{Lease=lease},cancel.Token);}catch(Exception e){status.Text=e.Message;await Release();}finally{input.Release();}
    }
    private async Task Release()
    {
        var token=lease;lease="";relative=false;Mouse.Capture(null);image.Cursor=Cursors.Arrow;heartbeat.Stop();if(token.Length==0)return;
        try{using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(2));await client.Command(new("release",account.Id,Lease:token),timeout.Token);}catch(Exception){}if(!closing)status.Text="View only · control released";
    }
    private async Task Receive()
    {
        var frames=0;var stopwatch=Stopwatch.StartNew();
        try
        {
            authorize();await client.Stream(account.Id,async bytes=>
            {authorize();var bitmap=new BitmapImage();using(var stream=new MemoryStream(bytes)){bitmap.BeginInit();bitmap.CacheOption=BitmapCacheOption.OnLoad;bitmap.StreamSource=stream;bitmap.EndInit();bitmap.Freeze();}image.Source=bitmap;frames++;if(stopwatch.Elapsed.TotalSeconds>=1){status.Text=$"{frames/stopwatch.Elapsed.TotalSeconds:N0} FPS · {bitmap.PixelWidth} × {bitmap.PixelHeight} · {(lease.Length>0?"Control active":"View only")}";frames=0;stopwatch.Restart();}await Task.CompletedTask;},cancel.Token);
        }
        catch(Exception e)when(e is not OutOfMemoryException){status.Text=cancel.IsCancellationRequested?"Disconnected":e.Message;}
        finally{await Release();}
    }
}
