using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Orbit.Core;
namespace Orbit.Desktop;
public sealed class MonitorWindow:Window
{
    private readonly DispatcherTimer timer=new(){Interval=TimeSpan.FromSeconds(1)};
    public MonitorWindow(MainWindow main,IEnumerable<Account> accounts)
    {
        SetResourceReference(StyleProperty,typeof(Window));
        Owner=main;Title="Orbit monitor";Width=330;Height=260;Topmost=true;WindowStartupLocation=WindowStartupLocation.CenterOwner;
        var panel=new StackPanel{Margin=new(20)};var heading=new TextBlock{Text="Orbit · Live sessions",FontSize=20,Margin=new(0,0,0,14)};var status=new TextBlock{TextWrapping=TextWrapping.Wrap};panel.Children.Add(heading);panel.Children.Add(status);var restore=new Button{Content="Open workspace",Margin=new(0,20,0,0)};restore.Click+=(_,_)=>{main.Show();main.WindowState=WindowState.Normal;main.Activate();};panel.Children.Add(restore);Content=panel;
        timer.Tick+=(_,_)=>status.Text=string.Join("\n",accounts.Where(GameWindows.Owned).Take(6).Select(a=>a.Label+" · "+a.Status));timer.Start();Closed+=(_,_)=>timer.Stop();
    }
}
