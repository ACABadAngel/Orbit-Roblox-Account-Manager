using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;
using Orbit.Core;
using Screen = System.Windows.Forms.Screen;

namespace Orbit.Desktop;
public partial class MainWindow : Window
{
    private readonly WorkspaceStore store;
    private readonly HttpClient http;
    private readonly RobloxApi api;
    private readonly RobloxInstaller installer;
    private readonly LayoutService layouts = new();
    private readonly ObservableCollection<Account> accounts;
    private readonly DispatcherTimer refresh = new() { Interval = TimeSpan.FromSeconds(1) };
    private CancellationTokenSource? operation;
    private bool closing, multiEnabled, capturing;
    private DataGrid? accountGrid;
    private string search = "";
    private readonly Dictionary<string, Image> liveImages = [];
    private readonly Dictionary<int, string> processOwners = [];
    public MainWindow(WorkspaceStore store, HttpClient http, bool smokeMode = false, HttpClient? artworkClient = null)
    {
        InitializeComponent(); this.store = store; this.http = http; api = new(http); licensing = new(http,store);
        if(!smokeMode) Loaded += async (_,_) => await InitializeFeatures();
        installer = new(http, Path.Combine(store.DirectoryPath, "Roblox"), PublisherVerifier.Roblox);
        accounts = new(store.State.Accounts); InitializeDesign(artworkClient); ShowAccounts();
        refresh.Tick += Refresh; refresh.Start(); Closing += OnClosing;
        InputBindings.Add(new KeyBinding(new ActionCommand(CommandPalette), Key.K, ModifierKeys.Control));
        InputBindings.Add(new KeyBinding(new ActionCommand(()=>BasicSettingsClick(this,new())),Key.D1,ModifierKeys.Control));
        InputBindings.Add(new KeyBinding(new ActionCommand(GroupSettings),Key.D2,ModifierKeys.Control));
        InputBindings.Add(new KeyBinding(new ActionCommand(PrivateServersPage),Key.D3,ModifierKeys.Control));
    }
    private void Navigate(string title, string subtitle, UIElement content)
    { liveImages.Clear(); HeaderActions.Children.Clear(); PageTitle.Text = title; PageSubtitle.Text = subtitle; Page.Content = content; SetNavigation(title); }
    private static TextBlock Text(string value, double size = 14, bool muted = false) => new() { Text = value, FontSize = size, TextWrapping = TextWrapping.Wrap, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(muted ? "#A6A6A6" : "#F2F2F2")), Margin = new(0,0,0,10) };
    private static Button Button(string label, Action action)
    { var button = new Button { Content = label }; button.Click += (_, _) => action(); return button; }
    private static WrapPanel Actions(params Button[] buttons)
    { var panel = new WrapPanel { Margin = new(0,0,0,12) }; foreach (var b in buttons) panel.Children.Add(b); return panel; }
    private static ScrollViewer Scroll(UIElement content) => new() { Content = content, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    private void Notify(string value) => Status.Text = value;
    private async Task ExecuteOperation(Func<CancellationToken,Task> action,CancellationToken caller=default)
    {
        if(operation is not null)throw new InvalidOperationException("Wait for the current operation or cancel it.");
        operation=CancellationTokenSource.CreateLinkedTokenSource(caller,lifetime.Token);CancelButton.Visibility=Visibility.Visible;
        try{await action(operation.Token);}finally{operation.Dispose();operation=null;CancelButton.Visibility=Visibility.Collapsed;}
    }
    private async Task Run(Func<CancellationToken, Task> action)
    {
        try { await ExecuteOperation(action); }
        catch (OperationCanceledException) { Notify("Operation cancelled. Completed work was kept."); }
        catch (Exception e) { Notify(e.Message); MessageBox.Show(this,e.Message,"Orbit",MessageBoxButton.OK,MessageBoxImage.Information); }
    }
    private async Task SaveAsync(string message)
    { store.Log(message); await store.SaveAsync(); Notify(message); }
    private IReadOnlyList<Account> Selected() => accountGrid?.SelectedItems.Cast<Account>().ToArray() ?? [];
    internal async Task SmokeViews(string output)
    {
        async Task CaptureView(string name,Action show)
        {
            show();UpdateLayout();await Dispatcher.InvokeAsync(()=>{},DispatcherPriority.ContextIdle);
            if(name.StartsWith("accounts") && (accountGrid is null || accountGrid.ActualWidth<400 || accountGrid.ActualHeight<180))throw new InvalidDataException("Account table is clipped by the filter panel.");
            var bitmap=new RenderTargetBitmap((int)ActualWidth,(int)ActualHeight,96,96,PixelFormats.Pbgra32);bitmap.Render(this);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using var file=File.Create(Path.Combine(output,name+".png"));encoder.Save(file);
        }
        foreach(var view in new (string,Action)[]{("accounts",ShowAccounts),("launcher",ShowLauncher),("settings",()=>SettingsClick(this,new())),("layouts",()=>LayoutsClick(this,new())),("audio",()=>AudioClick(this,new())),("migration",()=>MigrationClick(this,new())),("machines",()=>MachinesClick(this,new())),("automation",ShowAutomation),("licence",LicensePage),("live",()=>LiveClick(this,new())),("profiles",()=>BasicSettingsClick(this,new())),("activity",()=>ActivityClick(this,new()))})await CaptureView(view.Item1,view.Item2);
        var original=accounts.ToArray();accounts.Clear();await CaptureView("accounts-empty",ShowAccounts);foreach(var a in original)accounts.Add(a);
        refresh.Stop();closing=true;
    }
    private void AccountsClick(object sender, RoutedEventArgs e) => ShowAccounts();
    private void SignIn()
    {
        if (operation is not null) { Notify("Wait for the current operation first."); return; }
        var dialog = new RobloxSignIn(this);
        if (dialog.ShowDialog() == true && dialog.Session is { } session)
            _ = Run(async ct => { await Connect(session, "Main", ct); await SaveAsync("Account connected through Roblox sign-in."); ShowAccounts(); });
    }
    private void AddAccount()
    {
        var dialog = new FormDialog(this, "Connect a Roblox account", "Paste a session from an account you own. Orbit validates it with Roblox, then protects it with your Windows account. No password is collected.");
        var secret = dialog.Password("Roblox session"); var group = dialog.Text("Group", "Main");
        if (dialog.ShowDialog() == true)
        { var value = secret.Password; var target = group.Text.Trim(); dialog.ClearSecrets(); _ = Run(async ct => { await Connect(value, target, ct); await SaveAsync("Account connected."); ShowAccounts(); }); }
        else dialog.ClearSecrets();
    }
    private void ImportFile()
    {
        var dialog = new OpenFileDialog { Filter = "Session files|*.txt;*.csv;*.log", Title = "Import sessions you own" };
        if (dialog.ShowDialog(this) != true) return;
        _ = Run(async ct =>
        {
            if (new System.IO.FileInfo(dialog.FileName).Length > 5_000_000) throw new InvalidDataException("Import is limited to 5 MB.");
            var rows = RobloxApi.ParseSessions(await File.ReadAllTextAsync(dialog.FileName, ct)); int imported = 0, failed = 0;
            foreach (var row in rows)
            {
                ct.ThrowIfCancellationRequested(); Notify($"Validating account {imported + failed + 1} of {rows.Count}…");
                try { await Connect(row, "Main", ct); imported++; }
                catch (RobloxException e) when (!e.Pause) { failed++; }
                // Checkpoints preserve completed imports if cancellation or a rate limit stops the batch.
                await store.SaveAsync();
            }
            await SaveAsync($"Import complete: {imported} connected, {failed} expired or invalid."); ShowAccounts();
        });
    }
    private async Task Connect(string cookie, string group, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(group) || group.Length > 80) throw new ArgumentException("Use a group name of 1–80 characters.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var user = await api.UserAsync(cookie, timeout.Token);
        var account = store.State.Accounts.FirstOrDefault(a => a.UserId == user.Id);
        if (account is null)
        {
            if (accounts.Count >= 5000) throw new InvalidOperationException("The workspace has reached 5,000 accounts.");
            account = new() { UserId = user.Id, Group = group }; store.State.Accounts.Add(account); accounts.Add(account);
        }
        account.Username = user.Name; account.DisplayName = user.DisplayName; account.Error = "";
        api.ResumeAfterSignIn(); store.PutSession(account.Id, cookie); if (!store.State.Groups.Contains(group)) store.State.Groups.Add(group);
    }
    private async Task CheckHealth(CancellationToken ct)
    {
        var selected = Selected(); if (selected.Count == 0) throw new InvalidOperationException("Select accounts to check.");
        foreach (var a in selected)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(20));
                var user = await api.UserAsync(store.Session(a.Id), timeout.Token);
                if (user.Id != a.UserId) throw new InvalidDataException("Session belongs to another account. Sign in again.");
                a.Error = ""; if (!GameWindows.Owned(a)) a.Status = "Ready";
            }
            catch (RobloxException e) { a.Error = e.Message; if (!GameWindows.Owned(a)) a.Status = "Sign-in required"; if (e.Pause) throw; }
        }
        await SaveAsync("Account health check finished.");
    }
    private Task LaunchSelected(CancellationToken ct) => LaunchAccounts(Selected(),ct);
    private async Task LaunchAccounts(IReadOnlyList<Account> selection,CancellationToken ct,bool recovery=false)
    {
        var selected = selection.ToArray(); if (selected.Length == 0) throw new InvalidOperationException("Select accounts to launch.");
        foreach (var a in selected) LaunchUri.ValidateProfile(Profile(a));
        if (selected.Any(a => Profile(a).PlaceId.Length == 0)) throw new InvalidOperationException("Set a place ID in Settings → Launch profiles first.");
        if (store.State.Launcher.MultiSession && !multiEnabled)
        {
            multiEnabled = OrbitWindow.EnableMulti();
            if (!multiEnabled) throw new InvalidOperationException("Close every Roblox client and other multi-instance manager, then try again with Orbit open first.");
        }
        var client = await EnsureClient(ct);
        foreach (var a in selected)
        {
            ct.ThrowIfCancellationRequested(); if (GameWindows.Owned(a)) continue;
            var p = Profile(a); a.StopRequested=false; a.RecoverAt=null; if(!recovery)a.RecoveryAttempts.Clear(); a.Status = "Launching"; a.Error = "";
            try
            {
                await ClientCustomization.ApplyFlagsAsync(client, store.State.Launcher.FastFlags, p, ct);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(20));
                var ticket = await api.TicketAsync(store.Session(a.Id), p.PlaceId, timeout.Token);
                var server=PrivateServers.Choose(store.State,a,store.State.OptionsFor(a),serverCursors);
                var target=server is null?null:await PrivateServers.Resolve(http,server,store.Session(a.Id),timeout.Token);
                if(server is not null && server.PlaceId!=p.PlaceId)throw new InvalidOperationException("Private server belongs to a different profile place.");
                var launchUri = LaunchUri.Build(ticket, p,target:target);
                ct.ThrowIfCancellationRequested();
                var before = GameWindows.List().Select(w => w.Handle).ToHashSet();
                var start = new ProcessStartInfo(client.Executable) { UseShellExecute = false, WorkingDirectory = client.Directory };
                start.ArgumentList.Add(launchUri);
                using var process = Process.Start(start) ?? throw new InvalidOperationException("Windows could not start Roblox.");
                a.Status = "Awaiting window"; Notify($"Waiting for {a.Label}…");
                var attached = false;
                for (var i = 0; i < 60; i++)
                {
                    await Task.Delay(500, ct);
                    var newWindows = GameWindows.List().Where(w => !before.Contains(w.Handle) && !processOwners.ContainsKey(w.Pid)).ToArray();
                    if (newWindows.Length > 1) break;
                    if (newWindows.Length == 1) { GameWindows.Attach(a, newWindows[0]); processOwners[a.ProcessId] = a.Id; ApplyAudio(a); ApplyAutomaticLayout(a); attached = true; break; }
                }
                if (!attached) { a.Status = "Attach window"; Notify("Window matching was uncertain. Use Attach window and verify the account."); break; }
                await SaveAsync($"Launched {a.Label}.");
                await Task.Delay(TimeSpan.FromSeconds(store.State.OptionsFor(a).DelaySeconds), ct);
            }
            catch (OperationCanceledException) { if (a.Status == "Launching") a.Status = "Idle"; throw; }
            catch (Exception e) { a.Error = e.Message; a.Status = "Launch paused"; if(recovery && e is not RobloxException)ScheduleRecovery(a); throw; }
        }
    }
    private LaunchProfile Profile(Account a) => store.State.Profiles.FirstOrDefault(p => p.Id == (store.State.OptionsFor(a).ProfileId.Length>0?store.State.OptionsFor(a).ProfileId:a.ProfileId)) ?? store.State.Profiles[0];
    private async Task<InstalledClient> EnsureClient(CancellationToken ct, bool repair = false, bool forceUpdate = false)
    {
        if (repair && GameWindows.List().Count > 0) throw new InvalidOperationException("Close all Roblox clients before repairing.");
        var client = await installer.EnsureAsync(store.State.Launcher.Channel, forceUpdate || store.State.Launcher.UpdateBeforeLaunch, repair,
            new Progress<InstallProgress>(p => Notify($"{p.Message} · {p.Fraction:P0}")), ct);
        store.State.Launcher.CurrentVersion = client.Version; await store.SaveAsync(); return client;
    }
    private void StopSelected()
    {
        var selected = Selected(); operation?.Cancel(); foreach(var a in selected){a.StopRequested=true;a.RecoverAt=null;GameWindows.Stop(a);} _ = Run(async _ => { foreach (var a in selected) { GameWindows.Stop(a); processOwners.Remove(a.ProcessId); } await SaveAsync("Selected sessions stopped."); });
    }
    private void EditAccount()
    {
        if (Selected().FirstOrDefault() is not { } a) { Notify("Select an account first."); return; }
        var dialog = new FormDialog(this, "Account settings"); var alias = dialog.Text("Alias", a.Alias); var group = dialog.Text("Group", a.Group); var notes = dialog.Text("Notes", a.Notes, true); var profile = dialog.Choose("Launch profile", store.State.Profiles, Profile(a)); var server=dialog.Choose("Assigned private server",new[]{new PrivateServer{Id="",Name="None"}}.Concat(store.State.PrivateServers).ToArray(),store.State.PrivateServers.FirstOrDefault(s=>s.Id==a.ServerId)??new PrivateServer{Id="",Name="None"}); var recovery=dialog.Toggle("Allow automatic relaunch for this account",a.AutoRelaunch);
        if (dialog.ShowDialog() == true) _ = Run(async _ =>
        {
            if (alias.Text.Length > 80 || group.Text.Length is < 1 or > 80 || notes.Text.Length > 4000) throw new ArgumentException("Account fields are too long or group is empty.");
            a.Alias = alias.Text.Trim(); a.Group = group.Text.Trim(); a.Notes = notes.Text; a.ProfileId = ((LaunchProfile)profile.SelectedItem).Id; a.ServerId=(server.SelectedItem as PrivateServer)?.Id??""; a.AutoRelaunch=recovery.IsChecked==true;
            if (!store.State.Groups.Contains(a.Group)) store.State.Groups.Add(a.Group);
            await SaveAsync("Account settings saved."); ShowAccounts();
        });
    }
    private void AttachWindow()
    {
        if (Selected().FirstOrDefault() is not { } a) { Notify("Select an account first."); return; }
        var candidates = GameWindows.List().Where(w => !processOwners.ContainsKey(w.Pid) || processOwners[w.Pid] == a.Id).ToArray();
        if (candidates.Length == 0) { Notify("No unassigned Roblox window is available."); return; }
        var dialog = new FormDialog(this, "Attach game window", "Verify the Roblox username in this game window before assigning it. Orbit cannot read which account is signed in.");
        var chosen = dialog.Choose("Roblox window", candidates, candidates[0]);
        if (dialog.ShowDialog() == true) { processOwners.Remove(a.ProcessId); var w = (GameWindow)chosen.SelectedItem; GameWindows.Attach(a, w); processOwners[w.Pid] = a.Id; Notify("Roblox window attached."); }
    }
    private void RemoveAccounts()
    {
        var selected = Selected().ToArray();
        if (selected.Length == 0 || MessageBox.Show(this, "Remove selected account records and their saved sessions? Running games remain open.", "Remove accounts", MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
        _ = Run(async _ => { layouts.Restore(selected); foreach (var a in selected) { store.Remove(a); accounts.Remove(a); processOwners.Remove(a.ProcessId); } await SaveAsync("Account records removed."); });
    }
    private void LauncherClick(object sender, RoutedEventArgs e) => ShowLauncher();
    private static void GuardNoGames() { if (GameWindows.List().Count > 0) throw new InvalidOperationException("Close all Roblox clients before changing this installation."); }
    private static void OpenFolder(string path) { Directory.CreateDirectory(path); Process.Start(new ProcessStartInfo("explorer.exe") { ArgumentList = { path }, UseShellExecute = false })?.Dispose(); }
    private void EditFlags()
    {
        var dialog = new FormDialog(this, "Global FastFlags", "Only flags permitted by Roblox take effect. This does not bypass the Roblox allowlist.");
        var json = dialog.Text("JSON object", JsonSerializer.Serialize(store.State.Launcher.FastFlags, WorkspaceStore.Json), true);
        if (dialog.ShowDialog() == true) _ = Run(async _ => { var parsed = ClientCustomization.ParseFlags(json.Text); store.State.Launcher.FastFlags = parsed; await SaveAsync("FastFlags saved for the next launch."); });
    }
    private void BasicSettingsClick(object sender, RoutedEventArgs e)
    {
        var panel = new StackPanel();
        panel.Children.Add(Actions(Button("General",()=>SettingsClick(this,new())),Button("Launch profiles",()=>BasicSettingsClick(this,new())),Button("Group rules",GroupSettings),Button("Private servers",PrivateServersPage),Button("Updates",()=>_=CheckForUpdates(true))));
        foreach(var profile in store.State.Profiles)
        {
            var p=profile;var preview=GameSummary(p);var actions=Actions(Button("Edit profile",()=>EditProfile(p)));
            panel.Children.Add(Card(Columns(2,1,preview,actions)));
        }
        panel.Children.Add(Button("Add launch profile",()=>EditProfile(null)));
        var spacing=new TextBox{Text=store.State.Launcher.LaunchDelaySeconds.ToString(),Width=100,HorizontalAlignment=HorizontalAlignment.Left};
        panel.Children.Add(Card(Section("Launch spacing",Text("Seconds between launches. Group rules can override this value.",12,true),spacing,Button("Save spacing",()=>_=Run(async _=>{if(!int.TryParse(spacing.Text,out var seconds)||seconds is <0 or >120)throw new ArgumentException("Choose 0–120 seconds.");store.State.Launcher.LaunchDelaySeconds=seconds;await SaveAsync("Launch spacing saved.");})))));
        Navigate("Settings","Profiles, recovery, backups, licences and app updates.",Scroll(panel));
    }
    private void EditProfile(LaunchProfile? existing)
    {
        var dialog = new FormDialog(this, "Launch profile"); var name = dialog.Text("Name", existing?.Name ?? "New profile"); var place = dialog.Text("Place ID", existing?.PlaceId ?? ""); var job = dialog.Text("Server job ID (optional)", existing?.JobId ?? "");
        var flags = dialog.Text("Profile FastFlags (JSON)", JsonSerializer.Serialize(existing?.FastFlags ?? [], WorkspaceStore.Json), true);
        if (dialog.ShowDialog() == true) _ = Run(async _ =>
        {
            var p = new LaunchProfile { Id = existing?.Id ?? Guid.NewGuid().ToString(), Name = name.Text.Trim(), PlaceId = place.Text.Trim(), JobId = job.Text.Trim(), FastFlags = ClientCustomization.ParseFlags(flags.Text) };
            LaunchUri.ValidateProfile(p);
            if (existing is null) store.State.Profiles.Add(p); else store.State.Profiles[store.State.Profiles.IndexOf(existing)] = p;
            await SaveAsync("Launch profile saved."); SettingsClick(this, new());
        });
    }
    private void SimpleLayoutsClick(object sender, RoutedEventArgs e)
    {
        var content = new StackPanel(); var monitors = Screen.AllScreens;
        var monitor = new ComboBox { ItemsSource = monitors.Select((s,i) => new MonitorOption(s, i)).ToArray(), SelectedIndex = 0, HorizontalAlignment = HorizontalAlignment.Left };
        content.Children.Add(Text("Monitor", 18)); content.Children.Add(monitor);
        var columns = new TextBox { Text = "2", Width = 90, HorizontalAlignment = HorizontalAlignment.Left }; content.Children.Add(Text("Columns (1–8)")); content.Children.Add(columns);
        content.Children.Add(Actions(Button("Arrange running accounts", () => _ = Run(_ =>
        { if (!int.TryParse(columns.Text, out var n) || n is < 1 or > 8) throw new ArgumentException("Choose 1–8 columns."); var selected = ((MonitorOption)monitor.SelectedItem).Screen; layouts.Apply(accounts.Where(GameWindows.Owned).ToArray(), selected.WorkingArea, n); Notify("Windows arranged. Click a tile to expand/restore."); return Task.CompletedTask; })), Button("Restore original positions", () => { layouts.Restore(accounts); Notify("Window positions restored."); })));
        var tiles = new WrapPanel();
        foreach (var a in accounts.Where(GameWindows.Owned))
        { var account = a; var b = Button(account.Label, () => _ = Run(_ => { layouts.Toggle(account, ((MonitorOption)monitor.SelectedItem).Screen.WorkingArea); return Task.CompletedTask; })); b.Width = 200; b.Height = 120; tiles.Children.Add(b); }
        content.Children.Add(tiles); content.Children.Add(Text("Game-enforced minimum sizes remain in force. Orbit does not patch Roblox to bypass them.", 12, true));
        Navigate("Layouts", "Detected monitors and physical pixel sizes. Arrange attached windows, then expand and restore.", Scroll(content));
    }
    private sealed record MonitorOption(Screen Screen, int Index)
    { public override string ToString() => $"Monitor {Index + 1} · {Screen.Bounds.Width} × {Screen.Bounds.Height} · {Screen.DeviceName}{(Screen.Primary ? " · Primary" : "")}"; }
    private static void ApplyAudio(Account a) { if(!GameWindows.Owned(a))return;try{a.AudioApplied=OrbitAudio.Set((uint)a.ProcessId,(float)a.Volume,a.Muted)>0;if(a.AudioApplied&&a.Error.StartsWith("Audio is unavailable",StringComparison.Ordinal))a.Error="";}catch(System.Runtime.InteropServices.COMException){a.AudioApplied=false;a.Error="Audio is unavailable. Orbit will retry when the game’s audio session is ready.";} }
    private async void Refresh(object? sender, EventArgs e)
    {
        foreach (var a in accounts)
        {
            if (a.Window != 0 && !GameWindows.Owned(a)) { processOwners.Remove(a.ProcessId); a.Window = 0; a.Status = "Disconnected"; ScheduleRecovery(a); }
            UpdateMetrics(a);
            if(GameWindows.Owned(a)&&!a.AudioApplied)ApplyAudio(a);
        }
        await TickFeatures();
        if (capturing || liveImages.Count == 0) return;
        capturing = true;
        try
        {
            foreach (var a in accounts.ToArray())
                if (liveImages.TryGetValue(a.Id, out var image) && GameWindows.Owned(a))
                { var handle = a.Window; var bitmap = await Task.Run(() => Capture(handle)); if (GameWindows.Owned(a) && a.Window == handle) image.Source = bitmap; }
        }
        catch (Exception ex) when (ex is ArgumentException or System.Runtime.InteropServices.ExternalException or InvalidOperationException) { Notify("This window could not be captured. Open the game directly."); }
        finally { capturing = false; }
    }
    [DllImport("user32.dll")] private static extern bool PrintWindow(nint window, nint dc, uint flags);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(nint handle);
    private static BitmapSource? Capture(nint window)
    {
        if (!OrbitWindow.GetClientRect(window, out var r) || r.Right <= 0 || r.Bottom <= 0 || (long)r.Right * r.Bottom > 16_000_000) return null;
        using var bitmap = new System.Drawing.Bitmap(r.Right, r.Bottom); using var graphics = System.Drawing.Graphics.FromImage(bitmap);
        var dc = graphics.GetHdc(); bool ok;
        try { ok = PrintWindow(window, dc, 3); } finally { graphics.ReleaseHdc(dc); }
        if (!ok) return null; var h = bitmap.GetHbitmap();
        try { var source = System.Windows.Interop.Imaging.CreateBitmapSourceFromHBitmap(h, 0, Int32Rect.Empty, BitmapSizeOptions.FromWidthAndHeight(560, 340)); source.Freeze(); return source; }
        finally { DeleteObject(h); }
    }
    private void CancelClick(object sender, RoutedEventArgs e) => operation?.Cancel();
    private async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (closing) return;
        if (operation is not null) { e.Cancel = true; operation.Cancel(); Notify("Cancelling operation. Close Orbit again once it finishes."); return; }
        e.Cancel = true; refresh.Stop();
        try { await ShutdownFeatures(); layouts.Restore(accounts); await store.SaveAsync(); }
        catch (Exception) { refresh.Start(); MessageBox.Show(this, "Could not save the native workspace. Close again after checking disk access.", "Orbit"); return; }
        if (multiEnabled) OrbitWindow.DisableMulti(); layouts.Dispose(); artworkHttp.Dispose(); http.Dispose(); closing = true; Close();
    }
}
internal sealed class ActionCommand(Action action) : ICommand
{
    public bool CanExecute(object? parameter) => true;
    public void Execute(object? parameter) => action();
    public event EventHandler? CanExecuteChanged { add { } remove { } }
}
