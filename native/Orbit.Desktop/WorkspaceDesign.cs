using System.Globalization;
using System.Net.Http;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Orbit.Core;
using Screen = System.Windows.Forms.Screen;

namespace Orbit.Desktop;

public partial class MainWindow
{
    private HttpClient artworkHttp = null!;
    private RobloxArtwork artwork = null!;
    private readonly Dictionary<string, Button> navigation = [];
    private Action? designTick;
    internal int LoadedGameImages { get; private set; }
    private static SolidColorBrush Ink(string color) => new((Color)ColorConverter.ConvertFromString(color));
    private void InitializeDesign(HttpClient? artworkClient)
    {
        artworkHttp = artworkClient ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromSeconds(25) };
        artworkHttp.DefaultRequestHeaders.UserAgent.ParseAdd("Orbit/0.6.3");
        artwork = new(artworkHttp, lifetime.Token);
        foreach (var item in new (string Title, string Glyph, Action Action)[] {
            ("Accounts","\uE77B",ShowAccounts),("Roblox launcher","\uE7FC",ShowLauncher),("Live view","\uE7F4",()=>LiveClick(this,new())),
            ("Layouts","\uE8A9",()=>LayoutsClick(this,new())),("Machines","\uE770",()=>MachinesClick(this,new())),
            ("Automation","\uE945",ShowAutomation),("Audio","\uE767",()=>AudioClick(this,new())),("Activity","\uE9D9",()=>ActivityClick(this,new())),
            ("Backups & migration","\uE753",()=>MigrationClick(this,new())),("Settings","\uE713",()=>SettingsClick(this,new())),("Account & Licence","\uE77B",LicensePage) })
        {
            if (item.Title == "Backups & migration") Sidebar.Children.Add(new TextBlock { Text="MANAGE", Foreground=Ink("#929292"),FontSize=10,Margin=new(5,24,0,7) });
            var row = new StackPanel { Orientation=Orientation.Horizontal }; row.Children.Add(Glyph(item.Glyph,15)); row.Children.Add(new TextBlock { Text=item.Title,FontSize=12,VerticalAlignment=VerticalAlignment.Center,Margin=new(11,0,0,0) });
            var button = new Button { Content=row,Style=(Style)FindResource("NavButton") }; button.Click+=(_,_)=>item.Action(); Sidebar.Children.Add(button); navigation[item.Title]=button;
        }
        refresh.Tick += (_,_)=>designTick?.Invoke();
    }
    private void SetNavigation(string title)
    {
        designTick=null;
        var section=navigation.ContainsKey(title)?title:store.State.Machines.Any(m=>m.Name==title)?"Machines":"Settings";
        foreach(var row in navigation) row.Value.Tag=row.Key==section?"Active":null;
        WorkspaceName.Text=accounts.FirstOrDefault()?.Label??"Personal";PlanBadge.Text=licensing.Status.Plan=="free"?"Free":licensing.Status.Plan;
    }
    private void MinimizeClick(object sender,RoutedEventArgs e)=>WindowState=WindowState.Minimized;
    private void MaximizeClick(object sender,RoutedEventArgs e)=>WindowState=WindowState==WindowState.Maximized?WindowState.Normal:WindowState.Maximized;
    private void CloseClick(object sender,RoutedEventArgs e)=>Close();
    private static TextBlock Glyph(string glyph,double size=20)=>new(){Text=glyph,FontFamily=new("Segoe MDL2 Assets"),FontSize=size,VerticalAlignment=VerticalAlignment.Center};
    private static Border Card(UIElement content,double padding=18)=>new(){Child=content,Padding=new(padding),Background=Ink("#202020"),BorderBrush=Ink("#343434"),BorderThickness=new(1),CornerRadius=new(8),Margin=new(0,0,0,14)};
    private static Button Primary(string title,Action action)
    {var button=Button(title,action);button.Background=Ink("#ECECEC");button.Foreground=Ink("#202020");button.BorderBrush=Ink("#FAFAFA");return button;}
    private void Headers(params Button[] buttons){foreach(var button in buttons){button.FontSize=11;button.Padding=new(12,8,12,8);button.Margin=new(6,0,0,0);HeaderActions.Children.Add(button);}}
    private static Grid Columns(double left, double right, UIElement a, UIElement b, double gap=16)
    {
        var grid=new Grid();grid.ColumnDefinitions.Add(new(){Width=new(left,GridUnitType.Star)});grid.ColumnDefinitions.Add(new(){Width=new(gap)});grid.ColumnDefinitions.Add(new(){Width=new(right,GridUnitType.Star)});grid.Children.Add(a);Grid.SetColumn(b,2);grid.Children.Add(b);return grid;
    }
    private static StackPanel Section(string title,params UIElement[] children)
    {var panel=new StackPanel();panel.Children.Add(Text(title,17));foreach(var child in children)panel.Children.Add(child);return panel;}
    private static UIElement Note(string message)=>Card(Columns(.035,1,Glyph("\uE946",19),new TextBlock{Text=message,Foreground=Ink("#A6A6A6"),FontSize=12,TextWrapping=TextWrapping.Wrap},12),14);
    private static UIElement Empty(string title,string message,Button? action=null)
    {var panel=new StackPanel{VerticalAlignment=VerticalAlignment.Center,HorizontalAlignment=HorizontalAlignment.Center,MaxWidth=360,Margin=new(24,40,24,40)};panel.Children.Add(new TextBlock{Text="⬡",FontSize=32,Foreground=Ink("#777777"),HorizontalAlignment=HorizontalAlignment.Center,Margin=new(0,0,0,16)});panel.Children.Add(new TextBlock{Text=title,FontSize=18,FontWeight=FontWeights.SemiBold,TextAlignment=TextAlignment.Center,Margin=new(0,0,0,10)});panel.Children.Add(new TextBlock{Text=message,FontSize=12,Foreground=Ink("#A6A6A6"),TextAlignment=TextAlignment.Center,TextWrapping=TextWrapping.Wrap,Margin=new(0,0,0,18)});if(action is not null){action.HorizontalAlignment=HorizontalAlignment.Center;panel.Children.Add(action);}return panel;}
    private static BitmapImage Decode(byte[] bytes,int width)
    {using var stream=new MemoryStream(bytes);var image=new BitmapImage();image.BeginInit();image.CacheOption=BitmapCacheOption.OnLoad;image.DecodePixelWidth=width;image.StreamSource=stream;image.EndInit();image.Freeze();return image;}
    private Border Avatar(Account account,double size=32)
    {
        var image=new Image{Width=size,Height=size,Stretch=Stretch.UniformToFill};var fallback=Glyph("\uE77B",size*.55);fallback.HorizontalAlignment=HorizontalAlignment.Center;
        var grid=new Grid();grid.Children.Add(fallback);grid.Children.Add(image);var frame=new Border{Width=size,Height=size,CornerRadius=new(size/2),Background=Ink("#414141"),Child=grid,Clip=new EllipseGeometry(new Point(size/2,size/2),size/2,size/2)};
        frame.Loaded+=async(_,_)=>{try{image.Source=Decode(await artwork.Avatar(account.UserId,lifetime.Token),150);fallback.Visibility=Visibility.Collapsed;}catch(Exception e)when(e is not OutOfMemoryException){frame.ToolTip="Avatar unavailable. Reopen this view to retry.";}};return frame;
    }
    private UIElement AccountIdentity(Account a,bool subtitle=false)
    {var panel=new DockPanel();var avatar=Avatar(a);avatar.Margin=new(0,0,10,0);DockPanel.SetDock(avatar,Dock.Left);panel.Children.Add(avatar);var names=new StackPanel{VerticalAlignment=VerticalAlignment.Center};names.Children.Add(new TextBlock{Text=a.Label,FontSize=12,TextTrimming=TextTrimming.CharacterEllipsis});if(subtitle)names.Children.Add(new TextBlock{Text="@"+a.Username,Foreground=Ink("#969696"),FontSize=10,Margin=new(0,3,0,0),TextTrimming=TextTrimming.CharacterEllipsis});panel.Children.Add(names);return panel;}
    private UIElement GamePicture(LaunchProfile profile,bool wide=false)
    {
        var grid=new Grid{MinHeight=wide?125:64};var image=new Image{Stretch=Stretch.UniformToFill};var placeholder=new TextBlock{Text=profile.PlaceId.Length==0?"Choose a game profile":"Loading game image…",FontSize=11,Foreground=Ink("#A6A6A6"),TextAlignment=TextAlignment.Center,VerticalAlignment=VerticalAlignment.Center,TextWrapping=TextWrapping.Wrap,Margin=new(8)};grid.Children.Add(image);grid.Children.Add(placeholder);
        var retry=new Button{Content="Retry image",FontSize=10,Padding=new(8,4,8,4),HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Bottom,Visibility=Visibility.Collapsed,Margin=new(0,0,0,8)};grid.Children.Add(retry);
        async Task Load(){if(profile.PlaceId.Length==0)return;placeholder.Text="Loading game image…";retry.Visibility=Visibility.Collapsed;try{var result=await artwork.Game(profile.PlaceId,lifetime.Token);image.Source=Decode(wide?result.Thumbnail??result.Icon:result.Icon,wide?768:256);LoadedGameImages++;placeholder.Visibility=Visibility.Collapsed;grid.ToolTip=result.Name+(result.Creator.Length>0?" · by "+result.Creator:"");}catch(OperationCanceledException){placeholder.Text="Image loading paused";retry.Visibility=Visibility.Visible;}catch(Exception e)when(e is not OutOfMemoryException){placeholder.Text="Image unavailable";grid.ToolTip=e.Message;retry.Visibility=Visibility.Visible;}}
        grid.Loaded+=async(_,_)=>await Load();retry.Click+=async(_,_)=>await Load();return new Border{Child=grid,CornerRadius=new(6),Background=Ink("#292929"),ClipToBounds=true};
    }
    private UIElement GameSummary(LaunchProfile profile)
    {
        var row=new Grid();row.ColumnDefinitions.Add(new(){Width=new(64)});row.ColumnDefinitions.Add(new(){Width=new(12)});row.ColumnDefinitions.Add(new(){Width=new(1,GridUnitType.Star)});row.Children.Add(GamePicture(profile));var title=new TextBlock{Text=profile.Name,FontSize=13,FontWeight=FontWeights.SemiBold,TextWrapping=TextWrapping.Wrap};var creator=Text(profile.PlaceId.Length>0?"Place "+profile.PlaceId:"No place selected",11,true);var text=new StackPanel{VerticalAlignment=VerticalAlignment.Center};text.Children.Add(title);text.Children.Add(creator);Grid.SetColumn(text,2);row.Children.Add(text);
        row.Loaded+=async(_,_)=>{if(profile.PlaceId.Length==0)return;try{var game=await artwork.Game(profile.PlaceId,lifetime.Token);title.Text=game.Name;creator.Text="by "+game.Creator;}catch(Exception e)when(e is not OutOfMemoryException){/* GamePicture provides a retry control. */}};return row;
    }
    private sealed class CellConverter(Func<object,object> convert):IValueConverter
    {public object Convert(object value,Type t,object parameter,CultureInfo culture)=>convert(value);public object ConvertBack(object value,Type t,object parameter,CultureInfo culture)=>throw new NotSupportedException();}
    private static DataGridTemplateColumn Cell(string title,double width,IValueConverter converter)
    {var control=new FrameworkElementFactory(typeof(ContentControl));control.SetBinding(ContentControl.ContentProperty,new Binding("."){Converter=converter});return new(){Header=title,Width=new(width,DataGridLengthUnitType.Star),CellTemplate=new DataTemplate{VisualTree=control}};}
    private ContextMenu AccountMenu()
    {
        var menu=new ContextMenu();foreach(var item in new (string,Action)[]{("Paste session",AddAccount),("Import session file",ImportFile),("Check selected accounts",()=>_=Run(CheckHealth)),("Attach Roblox window",AttachWindow),("Select all",()=>accountGrid?.SelectAll()),("Account settings",EditAccount),("Save selected workflow",()=>EditAutomation(null,false)),("Remove selected",RemoveAccounts),("Stop all",StopAll)}){var command=new MenuItem{Header=item.Item1};command.Click+=(_,_)=>item.Item2();menu.Items.Add(command);}return menu;
    }
    private static Button MenuButton(ContextMenu menu)
    {var button=new Button{Content="···",Padding=new(10,7,10,7)};button.Click+=(_,_)=>{menu.PlacementTarget=button;menu.IsOpen=true;};return button;}
    private void ShowAccounts()
    {
        var panel=new DockPanel();var top=new Grid{Margin=new(0,0,0,14)};top.ColumnDefinitions.Add(new(){Width=new(1,GridUnitType.Star)});top.ColumnDefinitions.Add(new(){Width=new(200)});top.ColumnDefinitions.Add(new(){Width=new(125)});top.ColumnDefinitions.Add(new(){Width=new(125)});
        var counts=new StackPanel{Orientation=Orientation.Horizontal};var countLabels=new List<TextBlock>();foreach(var label in new[]{"Accounts","Running","Idle"}){var block=new StackPanel{Margin=new(0,0,24,0)};var number=new TextBlock{FontSize=21};countLabels.Add(number);block.Children.Add(number);block.Children.Add(new TextBlock{Text=label,FontSize=10,Foreground=Ink("#A6A6A6")});counts.Children.Add(block);}top.Children.Add(counts);
        var filter=new TextBox{Text=search,ToolTip="Search accounts",Margin=new(0,3,10,3),Padding=new(28,6,8,6),VerticalAlignment=VerticalAlignment.Center};System.Windows.Automation.AutomationProperties.SetName(filter,"Search accounts");
        var searchControl=new Grid();searchControl.Children.Add(filter);var searchIcon=Glyph("\uE721",12);searchIcon.Margin=new(9,0,0,0);searchIcon.HorizontalAlignment=HorizontalAlignment.Left;searchIcon.IsHitTestVisible=false;searchIcon.Foreground=Ink("#A6A6A6");searchControl.Children.Add(searchIcon);var watermark=new TextBlock{Text="Search accounts…",FontSize=11,Foreground=Ink("#A6A6A6"),Margin=new(28,0,0,0),VerticalAlignment=VerticalAlignment.Center,IsHitTestVisible=false};searchControl.Children.Add(watermark);filter.TextChanged+=(_,_)=>watermark.Visibility=filter.Text.Length==0?Visibility.Visible:Visibility.Collapsed;watermark.Visibility=filter.Text.Length==0?Visibility.Visible:Visibility.Collapsed;Grid.SetColumn(searchControl,1);top.Children.Add(searchControl);
        var groups=new ComboBox{ItemsSource=new[]{"All groups"}.Concat(store.State.Groups).ToArray(),SelectedItem=groupFilter,MinWidth=0,Margin=new(0,3,10,3),FontSize=11};Grid.SetColumn(groups,2);top.Children.Add(groups);
        var states=new ComboBox{ItemsSource=new[]{"All statuses","Running","Idle","Disconnected","Launch paused","Recovery scheduled","Sign-in required"},SelectedItem=statusFilter,MinWidth=0,Margin=new(0,3,0,3),FontSize=11};Grid.SetColumn(states,3);top.Children.Add(states);var filterCard=Card(top,14);DockPanel.SetDock(filterCard,Dock.Top);panel.Children.Add(filterCard);
        var view=CollectionViewSource.GetDefaultView(accounts);view.Filter=value=>value is Account a&&(a.Label.Contains(search,StringComparison.OrdinalIgnoreCase)||a.Username.Contains(search,StringComparison.OrdinalIgnoreCase)||a.Group.Contains(search,StringComparison.OrdinalIgnoreCase))&&(groupFilter=="All groups"||a.Group==groupFilter)&&(statusFilter=="All statuses"||a.Status==statusFilter);
        var table=new DataGrid{ItemsSource=view,FontSize=11,BorderThickness=new(0),RowHeight=52};accountGrid=table;
        var check=new FrameworkElementFactory(typeof(CheckBox));check.SetValue(CheckBox.TemplateProperty,SelectionTemplate());check.SetBinding(CheckBox.IsCheckedProperty,new Binding("IsSelected"){RelativeSource=new(RelativeSourceMode.FindAncestor,typeof(DataGridRow),1),Mode=BindingMode.TwoWay});table.Columns.Add(new DataGridTemplateColumn{Header="☐",Width=42,CellTemplate=new(){VisualTree=check}});
        table.Columns.Add(Cell("Account",2.3,new CellConverter(value=>AccountIdentity((Account)value))));
        var statusFactory=new FrameworkElementFactory(typeof(ContentControl));statusFactory.SetBinding(ContentControl.ContentProperty,new Binding("Status"){Converter=new CellConverter(value=>StatusPill(value?.ToString()??"Idle"))});table.Columns.Add(new DataGridTemplateColumn{Header="Status",Width=new(1.15,DataGridLengthUnitType.Star),CellTemplate=new(){VisualTree=statusFactory}});table.Columns.Add(new DataGridTextColumn{Header="Group",Binding=new Binding("Group"),Width=new(1,DataGridLengthUnitType.Star)});
        table.Columns.Add(new DataGridTextColumn{Header="CPU",Binding=new Binding("Resources"){Converter=new CellConverter(value=>Metric(value?.ToString(),true))},Width=56});table.Columns.Add(new DataGridTextColumn{Header="RAM",Binding=new Binding("Resources"){Converter=new CellConverter(value=>Metric(value?.ToString(),false))},Width=68});
        var tableBody=new Grid();tableBody.Children.Add(table);var noResults=Empty(accounts.Count==0?"Your workspace starts here":"No matching accounts",accounts.Count==0?"Add a Roblox account to organize profiles, launch games and control every session.":"Try another search, group or status.",accounts.Count==0?Primary("Add account",SignIn):null);tableBody.Children.Add(noResults);
        void Filter(){search=filter.Text;groupFilter=groups.SelectedItem as string??"All groups";statusFilter=states.SelectedItem as string??"All statuses";view.Refresh();noResults.Visibility=view.IsEmpty?Visibility.Visible:Visibility.Collapsed;}
        filter.TextChanged+=(_,_)=>Filter();groups.SelectionChanged+=(_,_)=>Filter();states.SelectionChanged+=(_,_)=>Filter();Filter();
        var detail=new StackPanel();detail.Children.Add(Text("Your session",16));detail.Children.Add(Text("Select an account to see its game and controls.",12,true));var inspector=Card(Scroll(detail),16);var tableCard=Card(tableBody,0);panel.Children.Add(Columns(3,1.15,tableCard,inspector));
        table.SelectionChanged+=(_,_)=>{detail.Children.Clear();detail.Children.Add(Text("Your session",16));if(table.SelectedItem is not Account a)return;detail.Children.Add(GameSummary(Profile(a)));detail.Children.Add(new Border{Height=1,Background=Ink("#373737"),Margin=new(0,16,0,16)});detail.Children.Add(AccountIdentity(a,true));var status=new TextBlock{FontSize=12,Margin=new(0,16,0,12),Foreground=Ink("#BDBDBD")};status.SetBinding(TextBlock.TextProperty,new Binding("Status"){Source=a});detail.Children.Add(status);detail.Children.Add(Text("Group    "+a.Group,12,true));var metric=new TextBlock{FontSize=11,TextWrapping=TextWrapping.Wrap,Foreground=Ink("#A6A6A6"),Margin=new(0,0,0,14)};metric.SetBinding(TextBlock.TextProperty,new Binding("Resources"){Source=a});detail.Children.Add(metric);
            var sessionActions=Actions(Primary("Launch",()=>_=Run(LaunchSelected)),Button("Stop",StopSelected),MenuButton(AccountMenu()));foreach(Button control in sessionActions.Children){control.FontSize=11;control.Padding=new(10,7,10,7);control.Margin=new(0,0,6,0);}detail.Children.Add(sessionActions);detail.Children.Add(Button("Play inside Orbit",()=>OpenLocalPlay(a)));detail.Children.Add(Button("Focus window",()=>_=Run(_=>{GameWindows.Focus(a);return Task.CompletedTask;})));var profile=new ComboBox{ItemsSource=store.State.Profiles,SelectedItem=Profile(a),MinWidth=0,FontSize=11};detail.Children.Add(profile);detail.Children.Add(Button("Use profile",()=>_=Run(async _=>{if(profile.SelectedItem is LaunchProfile chosen){a.ProfileId=chosen.Id;await SaveAsync("Account profile saved. Group overrides still apply.");ShowAccounts();}})));detail.Children.Add(Button("Screenshot",()=>SaveScreenshot(a)));var error=Text("",11,true);error.SetBinding(TextBlock.TextProperty,new Binding("Error"){Source=a});detail.Children.Add(error);};
        table.MouseDoubleClick+=(_,_)=>{if(table.SelectedItem is Account a)OpenLocalPlay(a);};
        Navigate("Accounts","Every account, profile and game window in one workspace.",panel);Headers(Button("Add account",SignIn),Primary("Launch selected",()=>_=Run(LaunchSelected)),Button("Stop selected",StopSelected),MenuButton(AccountMenu()));
        designTick=()=>{countLabels[0].Text=accounts.Count.ToString();countLabels[1].Text=accounts.Count(a=>a.Status=="Running").ToString();countLabels[2].Text=accounts.Count(a=>a.Status=="Idle").ToString();};designTick();if(accounts.Count>0)table.SelectedIndex=0;
    }
    private static UIElement StatusPill(string status)
    {var row=new StackPanel{Orientation=Orientation.Horizontal};row.Children.Add(new System.Windows.Shapes.Ellipse{Width=5,Height=5,Fill=Ink(status=="Running"?"#68DCA0":"#999999"),VerticalAlignment=VerticalAlignment.Center,Margin=new(0,0,5,0)});row.Children.Add(new TextBlock{Text=status,FontSize=10,VerticalAlignment=VerticalAlignment.Center,TextTrimming=TextTrimming.CharacterEllipsis});return row;}
    private static string Metric(string? resources,bool cpu)
    {var parts=resources?.Split('·');return parts?.Length==3?(cpu?parts[2].Replace("CPU","").Trim():parts[1].Trim()):"—";}
    private static ControlTemplate SelectionTemplate()
    {
        var box=new FrameworkElementFactory(typeof(Border));box.Name="Box";box.SetValue(Border.WidthProperty,12d);box.SetValue(Border.HeightProperty,12d);box.SetValue(Border.CornerRadiusProperty,new CornerRadius(2));box.SetValue(Border.BorderBrushProperty,Ink("#999999"));box.SetValue(Border.BorderThicknessProperty,new Thickness(1));box.SetValue(Border.BackgroundProperty,Brushes.Transparent);
        var template=new ControlTemplate(typeof(CheckBox)){VisualTree=box};var selected=new Trigger{Property=CheckBox.IsCheckedProperty,Value=true};selected.Setters.Add(new Setter(Border.BackgroundProperty,Ink("#EEEEEE"),"Box"));template.Triggers.Add(selected);return template;
    }
    private void ShowLauncher()
    {
        var panel=new StackPanel();var installed=installer.Current();
        var logo=new Border{Width=84,Height=84,Background=Ink("#303030"),CornerRadius=new(8),Child=new TextBlock{Text="▣",Foreground=Ink("#F04B4B"),FontSize=65,FontWeight=FontWeights.Bold,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center,RenderTransform=new RotateTransform(15),RenderTransformOrigin=new(.5,.5)}};
        var player=Section("Roblox Player",Text("Official Roblox client for Windows",12,true),Text(installed is null?"Not installed":"●  Installed · "+installed.Version,12,true));
        var commands=new StackPanel();commands.Children.Add(Button("Install / update",()=>_=Run(async ct=>{GuardNoGames();await EnsureClient(ct,false,true);await SaveAsync("Roblox installation ready.");ShowLauncher();})));commands.Children.Add(Button("Repair",()=>_=Run(async ct=>{GuardNoGames();await EnsureClient(ct,true);await SaveAsync("Roblox repaired.");ShowLauncher();})));commands.Children.Add(Primary("Open Roblox",OpenRoblox));panel.Children.Add(Card(Columns(3,1,Columns(1,4,logo,player),commands)));
        var channel=new ComboBox{ItemsSource=new[]{"live","zbeta","zintegration"},Text=store.State.Launcher.Channel,SelectedItem=store.State.Launcher.Channel,IsEditable=false};if(channel.SelectedItem is null){channel.ItemsSource=new[]{store.State.Launcher.Channel,"live","zbeta","zintegration"}.Distinct();channel.SelectedIndex=0;}
        var automatic=new CheckBox{Content="Check for Roblox updates before launch",IsChecked=store.State.Launcher.UpdateBeforeLaunch};var multiple=new CheckBox{Content="Keep multiple Roblox sessions open",IsChecked=store.State.Launcher.MultiSession};
        panel.Children.Add(Card(Section("Launch preferences",Text("Update channel",12,true),Columns(4,1,channel,Button("Custom channel",CustomRobloxChannel)),Text("Use the live channel for the latest version.",11,true),automatic,multiple)));
        panel.Children.Add(Card(Section("Client customization",Text("Roblox controls which FastFlags are allowed. Unsupported flags may be ignored. Content mods replace local images, sounds and fonts only.",12,true),Actions(Button("FastFlag profiles",EditFlags),Button("Open mods folder",()=>OpenFolder(Path.Combine(installer.Root,"Mods"))),Button("Apply mods",()=>_=Run(async ct=>{GuardNoGames();var client=await EnsureClient(ct);var count=await ClientCustomization.ApplyModsAsync(Path.Combine(installer.Root,"Mods"),client,ct);await SaveAsync($"Applied {count} content replacements. Repair restores original files.");})),Button("Open install folder",()=>OpenFolder(installer.Root))))));
        var save=Primary("Save launcher settings",()=>_=Run(async _=>{var next=Deployment.ValidateChannel(channel.SelectedItem as string??"live");if(next!=store.State.Launcher.Channel)GuardNoGames();if(multiple.IsChecked!=true&&multiEnabled){GuardNoGames();OrbitWindow.DisableMulti();multiEnabled=false;}store.State.Launcher.Channel=next;store.State.Launcher.UpdateBeforeLaunch=automatic.IsChecked==true;store.State.Launcher.MultiSession=multiple.IsChecked==true;await SaveAsync("Launcher settings saved.");}));save.HorizontalAlignment=HorizontalAlignment.Right;
        Navigate("Roblox launcher","Managed installation, channels and client customization.",Scroll(panel));Headers(save);
    }
    private void CustomRobloxChannel()
    {var form=new FormDialog(this,"Roblox update channel");var channel=form.Text("Channel",store.State.Launcher.Channel);if(form.ShowDialog()==true)_=Run(async _=>{var value=Deployment.ValidateChannel(channel.Text.Trim());if(value!=store.State.Launcher.Channel)GuardNoGames();store.State.Launcher.Channel=value;await SaveAsync("Roblox channel saved.");ShowLauncher();});}
    private void OpenRoblox()=>_=Run(async ct=>{var client=await EnsureClient(ct);await ClientCustomization.ApplyFlagsAsync(client,store.State.Launcher.FastFlags,null,ct);var start=new System.Diagnostics.ProcessStartInfo(client.Executable){WorkingDirectory=client.Directory,UseShellExecute=false};start.ArgumentList.Add("roblox://navigation/home");using var launched=System.Diagnostics.Process.Start(start);Notify("Roblox started. Sign in normally in the Roblox client.");});
    private void AudioClick(object sender,RoutedEventArgs e)
    {
        var panel=new StackPanel();var all=new Slider{Minimum=0,Maximum=100,Value=70,VerticalAlignment=VerticalAlignment.Center};var allValue=new TextBlock{FontSize=12,VerticalAlignment=VerticalAlignment.Center};allValue.SetBinding(TextBlock.TextProperty,new Binding("Value"){Source=all,StringFormat="{0:0}%"});var allMute=new CheckBox{Content="Mute"};
        var master=new Grid();foreach(var width in new[]{48d,0,54,112,190})master.ColumnDefinitions.Add(new(){Width=width==0?new(1,GridUnitType.Star):new(width)});master.Children.Add(Glyph("\uE767",26));var volume=new StackPanel();volume.Children.Add(Text("All accounts",14));volume.Children.Add(all);Grid.SetColumn(volume,1);master.Children.Add(volume);Grid.SetColumn(allValue,2);master.Children.Add(allValue);Grid.SetColumn(allMute,3);master.Children.Add(allMute);var apply=Primary("Apply to every account",()=>_=Run(async _=>{foreach(var a in accounts){a.Volume=all.Value/100;a.Muted=allMute.IsChecked==true;ApplyAudio(a);}await SaveAsync("Volume and mute saved for all accounts.");AudioClick(this,new());}));Grid.SetColumn(apply,4);master.Children.Add(apply);panel.Children.Add(Card(master));panel.Children.Add(Text("Per-account volume",17));
        foreach(var account in accounts)
        {
            var a=account;var slider=new Slider{Minimum=0,Maximum=100,Value=a.Volume*100,Margin=new(12,0,18,0),VerticalAlignment=VerticalAlignment.Center};var percentage=new TextBlock{VerticalAlignment=VerticalAlignment.Center,FontSize=12};percentage.SetBinding(TextBlock.TextProperty,new Binding("Value"){Source=slider,StringFormat="{0:0}%"});var mute=new CheckBox{IsChecked=a.Muted,ToolTip="Mute "+a.Label};System.Windows.Automation.AutomationProperties.SetName(mute,"Mute "+a.Label);
            var row=new Grid();foreach(var width in new[]{220d,0,50,62,80})row.ColumnDefinitions.Add(new(){Width=width==0?new(1,GridUnitType.Star):new(width)});var identity=new StackPanel();identity.Children.Add(AccountIdentity(a));var status=new TextBlock{FontSize=10,Foreground=Ink("#A6A6A6"),Margin=new(42,4,0,0)};status.SetBinding(TextBlock.TextProperty,new Binding("Status"){Source=a});identity.Children.Add(status);row.Children.Add(identity);Grid.SetColumn(slider,1);row.Children.Add(slider);Grid.SetColumn(percentage,2);row.Children.Add(percentage);Grid.SetColumn(mute,3);row.Children.Add(mute);var button=Button("Apply",()=>_=Run(async _=>{a.Volume=slider.Value/100;a.Muted=mute.IsChecked==true;ApplyAudio(a);await SaveAsync("Account audio saved.");}));button.Margin=new(8,0,0,0);Grid.SetColumn(button,4);row.Children.Add(button);panel.Children.Add(Card(row,14));
        }
        if(accounts.Count==0)panel.Children.Add(Card(Empty("No account audio yet","Add accounts first. Volume and mute settings are applied when their Roblox audio sessions start.",Primary("Add account",SignIn))));
        Navigate("Audio","Per-process Roblox volume. This changes all game audio, including music.",Scroll(panel));
    }
    private void LayoutsClick(object sender,RoutedEventArgs e)
    {
        var panel=new StackPanel();var screens=Screen.AllScreens;var monitor=new ComboBox{ItemsSource=screens.Select((s,i)=>new MonitorOption(s,i)).ToArray(),SelectedIndex=0,FontSize=11,MinWidth=0};
        var tiles=new UniformGrid{Columns=2};var previews=new Dictionary<string,Image>();
        void Render(){tiles.Children.Clear();previews.Clear();foreach(var a in accounts.Where(GameWindows.Owned)){
            var account=a;var image=new Image{Height=132,Stretch=Stretch.UniformToFill};previews[a.Id]=image;var content=new StackPanel();content.Children.Add(new TextBlock{Text=a.Label,FontSize=11,Margin=new(8,6,8,6),TextTrimming=TextTrimming.CharacterEllipsis});content.Children.Add(image);var button=Button("",()=>_=Run(_=>{layouts.Toggle(account,((MonitorOption)monitor.SelectedItem).Screen.WorkingArea);return Task.CompletedTask;}));button.Content=content;button.Padding=new(0);button.Margin=new(4);button.ToolTip="Expand / restore "+a.Label;tiles.Children.Add(button);
        }if(tiles.Children.Count==0){tiles.Columns=1;tiles.Children.Add(Empty("Your monitor workspace","Launch and attach game windows to arrange them here."));}}
        monitor.SelectionChanged+=(_,_)=>Render();Render();var workspace=Card(Section("Main monitor",monitor,tiles));
        var savedPanel=Section("Saved layouts");foreach(var item in store.State.Layouts){var saved=item;var miniature=new UniformGrid{Columns=2,Height=74,Margin=new(0,0,0,8)};foreach(var slot in saved.Slots.Take(4)){var account=accounts.FirstOrDefault(a=>a.Id==slot.AccountId);miniature.Children.Add(new Border{Margin=new(2),Background=Ink("#353535"),Child=account is null?new TextBlock{Text="Window",FontSize=10}:GamePicture(Profile(account),true)});}savedPanel.Children.Add(miniature);savedPanel.Children.Add(Text(saved.Name,12));savedPanel.Children.Add(Actions(Button("Apply",()=>_=Run(_=>{ApplyLayout(saved);return Task.CompletedTask;})),Button("Edit",()=>EditLayout(saved)),Button("Delete",()=>_=Run(async _=>{store.State.Layouts.Remove(saved);await SaveAsync("Layout removed.");LayoutsClick(this,new());}))));}
        if(store.State.Layouts.Count==0)savedPanel.Children.Add(Text("Save a layout to reuse window positions across your monitors.",12,true));panel.Children.Add(Columns(3,1.15,workspace,Card(savedPanel,14)));
        var live=Section("Live windows ("+accounts.Count(GameWindows.Owned)+")");foreach(var a in accounts.Where(GameWindows.Owned)){var account=a;var row=new DockPanel();var focus=Button("Focus",()=>_=Run(_=>{GameWindows.Focus(account);return Task.CompletedTask;}));DockPanel.SetDock(focus,Dock.Right);row.Children.Add(focus);row.Children.Add(AccountIdentity(a));live.Children.Add(Card(row,12));}panel.Children.Add(Card(live));
        Navigate("Layouts","Arrange windows across detected monitors. Click a live tile to focus or restore.",Scroll(panel));Headers(Button("New layout",()=>EditLayout(null)),Button("Quick grid",()=>SimpleLayoutsClick(this,new())),Button("Restore original positions",()=>{layouts.Restore(accounts);Notify("Original placements restored.");}));foreach(var entry in previews)liveImages[entry.Key]=entry.Value;
    }
    private void LiveClick(object sender,RoutedEventArgs e)
    {
        var tiles=new UniformGrid{Columns=2};var images=new Dictionary<string,Image>();foreach(var a in accounts.Where(GameWindows.Owned).Take(9)){var account=a;var image=new Image{Height=220,Stretch=Stretch.Uniform};images[a.Id]=image;var content=new StackPanel();content.Children.Add(AccountIdentity(a,true));content.Children.Add(image);content.Children.Add(Actions(Primary("Play inside Orbit",()=>OpenLocalPlay(account)),Button("Focus window",()=>_=Run(_=>{GameWindows.Focus(account);return Task.CompletedTask;}))));var card=Card(content);card.Margin=new(0,0,14,14);tiles.Children.Add(card);}
        Navigate("Live view","Your running Roblox windows, together in one workspace.",images.Count==0?Card(Empty("No live windows","Launch an account or attach an existing Roblox window to see it here.",Button("Open accounts",ShowAccounts))):Scroll(tiles));foreach(var image in images)liveImages[image.Key]=image.Value;
    }
    private void MachinesClick(object sender,RoutedEventArgs e)
    {
        var devices=new StackPanel();var detail=new StackPanel();
        void ThisPc(){detail.Children.Clear();detail.Children.Add(Text("Machine details",17));detail.Children.Add(Text("This PC",23));detail.Children.Add(Text(Environment.MachineName,12,true));detail.Children.Add(Text("Active sessions",12,true));detail.Children.Add(Text(accounts.Count(GameWindows.Owned)+" / "+accounts.Count,26));detail.Children.Add(Actions(Button("Launch across PCs",LaunchAcrossPcs)));detail.Children.Add(Actions(Button("Host settings",HostSettings),Button("Pairing details",PairingDetails),Button("Rotate host token",()=>_=Run(async _=>{store.State.Host.Token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));await RestartHost();await SaveAsync("Host token rotated. Controllers must pair again.");}))));detail.Children.Add(Text("Network",14));detail.Children.Add(Text(store.State.Host.Lan?"LAN / VPN · port "+store.State.Host.Port:"This PC only · port "+store.State.Host.Port,12,true));detail.Children.Add(Text("Use native Orbit on both PCs over LAN or a private VPN. Certificates are trusted only by their exact SHA-256 fingerprint.",12,true));var hosting=new CheckBox{Content="Allow this PC to run accounts for other paired devices",IsChecked=store.State.Host.Enabled};hosting.Click+=(_,_)=>HostSettings();detail.Children.Add(hosting);detail.Children.Add(Text("Hosting "+(store.State.Host.Enabled?"enabled":"disabled"),12,true));}
        var local=Button("",ThisPc);local.Content=Columns(.2,1,Glyph("\uE770",30),Section("This PC",Text(Environment.MachineName,11,true),Text("●  Local workspace",11,true)));local.HorizontalContentAlignment=HorizontalAlignment.Stretch;local.Margin=new(0,0,0,12);devices.Children.Add(local);
        foreach(var peer in store.State.Machines){var machine=peer;var row=new StackPanel();row.Children.Add(Text(machine.Name,16));row.Children.Add(Text(machine.Address,11,true));row.Children.Add(Actions(Button("Open accounts",()=>_=Run(async ct=>{RequireMachine(machine);using var client=new MachineClient(machine);var snapshot=await client.State(ct);ShowMachine(machine,snapshot);})),Button("Unpair",()=>_=Run(async _=>{store.State.Machines.Remove(machine);await SaveAsync("Machine unpaired.");MachinesClick(this,new());}))));devices.Children.Add(Card(row,14));}
        ThisPc();Navigate("Machines","Your accounts and launcher, across your own PCs.",Scroll(Columns(1.1,2,devices,Card(detail))));Headers(Button("Pair PC",PairMachine));
    }
    private void LaunchAcrossPcs()=>_=Run(async ct=>{licensing.Require("crossMachineBulk");foreach(var machine in store.State.Machines){RequireMachine(machine);using var client=new MachineClient(machine);var state=await client.State(ct);foreach(var a in state.Accounts.Where(a=>!a.Running))await client.Command(new("launch",a.Id),ct);}await SaveAsync("Cross-PC launch completed.");});
    private void ShowAutomation()
    {
        FrameworkElement? workflowSection=null;var panel=new StackPanel();panel.Children.Add(Actions(Button("Schedules",ShowAutomation),Button("Saved workflows",()=>workflowSection?.BringIntoView())));
        var schedules=new StackPanel();DayOfWeek? selectedDay=null;var dayButtons=new List<(DayOfWeek? Day,Button Button)>();var dayBar=new WrapPanel{Margin=new(0,0,0,12)};
        var rows=new StackPanel();
        Grid ScheduleRow(params UIElement[] cells)
        {
            var grid=new Grid{MinHeight=48};foreach(var width in new[]{1.9,.65,.8,1d,1.4,.65,.4})grid.ColumnDefinitions.Add(new(){Width=new(width,GridUnitType.Star)});
            for(var i=0;i<cells.Length;i++){Grid.SetColumn(cells[i],i);grid.Children.Add(cells[i]);}return grid;
        }
        TextBlock Label(string text,bool muted=false)=>new(){Text=text,Foreground=Ink(muted?"#A6A6A6":"#EEEEEE"),FontSize=11,VerticalAlignment=VerticalAlignment.Center,TextTrimming=TextTrimming.CharacterEllipsis,Margin=new(8,0,8,0)};
        void DrawSchedules()
        {
            rows.Children.Clear();rows.Children.Add(ScheduleRow(new[]{"Name","Time","Repeat","Group","Next run","Enabled",""}.Select(t=>(UIElement)Label(t,true)).ToArray()));
            foreach(var item in store.State.Schedules.Where(a=>selectedDay is null||a.Repeat=="daily"||a.At?.LocalDateTime.DayOfWeek==selectedDay))
            {
                var schedule=item;var enabled=new CheckBox{IsChecked=schedule.State=="pending",ToolTip="Enable "+schedule.Name,Margin=new(8)};
                System.Windows.Automation.AutomationProperties.SetName(enabled,"Enable "+schedule.Name);
                enabled.Click+=(_,_)=>_=Run(async _=>{schedule.State=enabled.IsChecked==true?"pending":"paused";await SaveAsync("Schedule updated.");DrawSchedules();});
                var menu=new ContextMenu();foreach(var command in new (string,Action)[]{("Edit",()=>EditAutomation(schedule,true)),("Delete",()=>DeleteAutomation(schedule,true))}){var entry=new MenuItem{Header=command.Item1};entry.Click+=(_,_)=>command.Item2();menu.Items.Add(entry);}
                var groups=string.Join(", ",accounts.Where(a=>schedule.AccountIds.Contains(a.Id)).Select(a=>a.Group).Distinct());
                var grid=ScheduleRow(Label(schedule.Name),Label(schedule.At?.ToLocalTime().ToString("HH:mm")??"—",true),Label(schedule.Repeat,true),Label(groups,true),Label(schedule.State=="pending"?schedule.At?.ToLocalTime().ToString("MMM d, HH:mm")??"—":schedule.State,true),enabled,MenuButton(menu));
                rows.Children.Add(new Border{Child=grid,BorderBrush=Ink("#333333"),BorderThickness=new(0,1,0,0)});
            }
            if(rows.Children.Count==1)rows.Children.Add(Empty(store.State.Schedules.Count==0?"Right accounts. Right time.":"No schedules on this day",store.State.Schedules.Count==0?"Create a schedule to launch or stop selected accounts.":"Choose another day or show all schedules.",store.State.Schedules.Count==0?Button("New schedule",()=>EditAutomation(null,true)):null));
            foreach(var item in dayButtons){var active=item.Day==selectedDay;item.Button.Background=Ink(active?"#EAEAEA":"#292929");item.Button.Foreground=Ink(active?"#202020":"#EEEEEE");}
        }
        foreach(var day in new DayOfWeek?[]{null,DayOfWeek.Monday,DayOfWeek.Tuesday,DayOfWeek.Wednesday,DayOfWeek.Thursday,DayOfWeek.Friday,DayOfWeek.Saturday,DayOfWeek.Sunday})
        {var choice=day;var button=Button(day is null?"All":day.ToString()![..3],()=>{selectedDay=choice;DrawSchedules();});button.FontSize=11;button.Padding=new(12,6,12,6);dayButtons.Add((day,button));dayBar.Children.Add(button);}
        schedules.Children.Add(dayBar);schedules.Children.Add(rows);DrawSchedules();panel.Children.Add(Card(schedules,14));
        var workflowTitle=Text("Workflow shortcuts",17);workflowSection=workflowTitle;panel.Children.Add(workflowTitle);var shortcuts=new UniformGrid{Columns=2};foreach(var item in store.State.Workflows){var s=item;var content=Section(s.Name,Text(s.Action=="stop"?"Stop selected running accounts.":"Launch a saved group of accounts.",12,true),Actions(Primary("Run workflow",()=>_=Run(async ct=>{licensing.Require("workflows");if(s.Action=="stop"){foreach(var a in accounts.Where(a=>s.AccountIds.Contains(a.Id))){a.StopRequested=true;GameWindows.Stop(a);}}else await LaunchAccounts(accounts.Where(a=>s.AccountIds.Contains(a.Id)).ToArray(),ct);await SaveAsync("Workflow: "+s.Name);})),Button("Edit",()=>EditAutomation(s,false)),Button("Delete",()=>DeleteAutomation(s,false))));var card=Card(content);card.Margin=new(0,0,14,14);shortcuts.Children.Add(card);}if(shortcuts.Children.Count==0)shortcuts.Children.Add(Card(Section("Your saved workflows",Text("Reuse a launch or stop action with the same accounts.",12,true),Button("Save workflow",()=>EditAutomation(null,false)))));panel.Children.Add(shortcuts);panel.Children.Add(Note("Keep Orbit and the host PC running. Recurring schedules and saved workflows require an active paid grant. Tasks over five minutes late are marked missed."));
        Navigate("Automation","Launch or stop the right accounts at the right time.",Scroll(panel));Headers(Button("New schedule",()=>EditAutomation(null,true)),Button("Save workflow",()=>EditAutomation(null,false)));
    }
    private void SettingsClick(object sender,RoutedEventArgs e)
    {
        var panel=new StackPanel();panel.Children.Add(Actions(Button("General",()=>SettingsClick(this,new())),Button("Launch profiles",()=>BasicSettingsClick(this,new())),Button("Group rules",GroupSettings),Button("Private servers",PrivateServersPage),Button("Updates",()=>_=CheckForUpdates(true))));
        var traySetting=new CheckBox{Content="Minimize Orbit to the system tray",IsChecked=store.State.MinimizeToTray};var updates=new CheckBox{Content="Check for app updates when Orbit opens",IsChecked=store.State.CheckUpdates};var channel=new ComboBox{ItemsSource=new[]{"stable","beta"},SelectedItem=store.State.UpdateChannel,Width=220,HorizontalAlignment=HorizontalAlignment.Left};panel.Children.Add(Card(Section("Application",traySetting,updates,Text("Update channel",12,true),channel,Text("Use the stable channel for the most reliable experience.",11,true),Actions(Button("Roblox URL handler",ProtocolSettings),Button("Open data folder",()=>OpenFolder(store.DirectoryPath))))));
        panel.Children.Add(Card(Section("Keyboard shortcuts",Text("Ctrl + K · Command palette    /    Ctrl + Shift + Backspace · Release local play input",12,true),Actions(Button("Ctrl + 1   Launch profiles",()=>BasicSettingsClick(this,new())),Button("Ctrl + 2   Group rules",GroupSettings),Button("Ctrl + 3   Private servers",PrivateServersPage)))));
        Navigate("Settings","Profiles, recovery, backups, licences and app updates.",Scroll(panel));Headers(Primary("Save changes",()=>_=Run(async _=>{store.State.MinimizeToTray=traySetting.IsChecked==true;store.State.CheckUpdates=updates.IsChecked==true;store.State.UpdateChannel=channel.SelectedItem as string??"stable";await SaveAsync("Preferences saved.");})));
    }
    private void LicensePage()
    {
        var status=licensing.Status;var panel=new StackPanel();var plan=Section("Your plan",Text("⬡   Orbit "+status.Plan.ToUpperInvariant(),27),Text(status.Plan=="free"?"Free local tools":"Active licence",12,true));plan.Children.Add(Card(Columns(1,1,Section("Managed PCs",Text(status.Devices.ToString(),24)),Section("Free local tools",Text("Available",18))),14));plan.Children.Add(Columns(1,1,Text("✓  Account management\n\n✓  Roblox launcher\n\n✓  Layouts and live view\n\nRemote tools follow your licence",12,true),Text("✓  Automation (basic)\n\n✓  Audio control\n\n✓  Backups & migration\n\n✓  Settings and updates",12,true)));plan.Children.Add(Text(licensing.Error,12,true));
        var key=new PasswordBox();var activation=Section("Activate licence",Text("Enter your Orbit licence key to unlock configured features.",12,true),key,Primary("Activate key",()=>{var value=key.Password;key.Clear();_=Run(async ct=>{await licensing.Activate(value,ct);await SaveAsync("Licence activated.");LicensePage();});}),Button("Configure service",ConfigureLicence),Button("Remove local key",()=>_=Run(async _=>{licensing.Clear();await SaveAsync("Local licence removed.");LicensePage();})));
        panel.Children.Add(Columns(1.2,1,Card(plan),Card(activation)));panel.Children.Add(Note("Payments are currently disabled. Activation accepts keys from the configured publisher service. Removing a local key does not reset a KeyAuth HWID binding."));Navigate("Account & Licence","Free local tools remain available without a key.",Scroll(panel));
    }
    private void MigrationClick(object sender,RoutedEventArgs e)
    {
        var panel=new StackPanel();string? backupPath=null;var restorePass=new PasswordBox();var exportPass=new PasswordBox();var chosen=Text("Drop your .orbit file here\nor browse for a file",13,true);chosen.TextAlignment=TextAlignment.Center;
        void Choose(){var picker=new Microsoft.Win32.OpenFileDialog{Filter="Encrypted Orbit backup|*.orbit"};if(picker.ShowDialog(this)==true){backupPath=picker.FileName;chosen.Text=Path.GetFileName(backupPath);}}
        var drop=Card(Section("",chosen,Button("Browse file",Choose)),20);drop.AllowDrop=true;drop.DragOver+=(_,args)=>{args.Effects=args.Data.GetDataPresent(DataFormats.FileDrop)?DragDropEffects.Copy:DragDropEffects.None;args.Handled=true;};drop.Drop+=(_,args)=>{if(args.Data.GetData(DataFormats.FileDrop) is string[] files&&files.Length==1&&Path.GetExtension(files[0]).Equals(".orbit",StringComparison.OrdinalIgnoreCase)){backupPath=files[0];chosen.Text=Path.GetFileName(backupPath);}};
        var restore=Section("Restore backup",Text("Restore accounts and encrypted data from a previous Orbit backup (.orbit).",12,true),drop,Text("Backup passphrase",11,true),restorePass,Primary("Restore backup",()=>{var pass=restorePass.Password;restorePass.Clear();var path=backupPath;if(path is null){Notify("Choose a backup file first.");return;}_=Run(async ct=>{if(new FileInfo(path).Length>50_000_000)throw new InvalidDataException("Backup exceeds 50 MB.");var data=await Task.Run(()=>BackupService.Decrypt(File.ReadAllText(path),pass),ct);var count=BackupService.Merge(store,data);accounts.Clear();foreach(var a in store.State.Accounts)accounts.Add(a);await SaveAsync($"Backup merged: {count} new accounts. Existing accounts kept.");ShowAccounts();});}));
        var export=Section("Export backup",Text("Export your accounts and settings to an encrypted Orbit backup file. Use a passphrase of at least 12 characters.",12,true),Text("Backup passphrase",11,true),exportPass,Primary("Export backup",()=>{var pass=exportPass.Password;exportPass.Clear();var picker=new Microsoft.Win32.SaveFileDialog{Filter="Encrypted Orbit backup|*.orbit",FileName="orbit-backup.orbit"};if(picker.ShowDialog(this)==true)_=Run(async ct=>{var data=BackupService.Export(store);var encrypted=await Task.Run(()=>BackupService.Encrypt(data,pass),ct);await File.WriteAllTextAsync(picker.FileName,encrypted,ct);Notify("Encrypted backup exported.");});}));
        panel.Children.Add(Columns(1,1,Card(restore),Card(export)));panel.Children.Add(Note("Existing accounts are kept. In the old app, export an encrypted Orbit backup, then restore that .orbit file here using its passphrase. Machine pairing and licences are configured separately."));Navigate("Backups & migration","One protected workspace for your accounts and launcher.",Scroll(panel));
    }
    private void ActivityClick(object sender,RoutedEventArgs e)
    {var panel=new StackPanel();foreach(var entry in store.State.Activity.Take(250))panel.Children.Add(Card(Text(entry,12,true),14));Navigate("Activity","Local workspace activity. Sessions and launch tickets are never logged.",store.State.Activity.Count==0?Card(Empty("All caught up","Launches, settings and workspace actions will appear here.")):Scroll(panel));}
}
