using System.Net.Http;
using System.Windows;
using Orbit.Core;
namespace Orbit.Desktop;
public partial class App : System.Windows.Application
{
    private Mutex? single;
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Length == 2 && e.Args[0] == "--smoke-test") { await NativeSmoke.Run(this, e.Args[1]); return; }
        if(e.Args.Length==4&&e.Args[0]=="--apply-update")
        {ShutdownMode=System.Windows.ShutdownMode.OnExplicitShutdown;try{await UpdateApplier.Apply(e.Args[1],e.Args[2],int.Parse(e.Args[3]));Shutdown(0);}catch(Exception ex){MessageBox.Show("Orbit update could not complete: "+ex.Message,"Orbit");Shutdown(1);}return;}
        single = new Mutex(true, "Local\\OrbitNativeWorkspace", out var created);
        if (!created) { if(e.Args.Length==2&&e.Args[0]=="--roblox") {try{await ProtocolPipe.Send(e.Args[1]);}catch(Exception){MessageBox.Show("Orbit could not receive this launch. Open it and try the link again.","Orbit");}} else MessageBox.Show("Orbit is already open. Use its tray icon to show the workspace.","Orbit");Shutdown(); return; }
        try
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Orbit", "NativePreview");
            var store = new WorkspaceStore(root, new DpapiProtector()); await store.LoadAsync();
            var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false };
            var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(5), MaxResponseContentBufferSize=5_500_000 };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("Orbit/0.6.0-CSharp-Preview");
            var window = new MainWindow(store, http); MainWindow = window; window.Show();
            if(e.Args.Length==2&&e.Args[0]=="--roblox")await window.HandleProtocol(e.Args[1]);
        }
        catch (Exception) { MessageBox.Show("Orbit could not open its native workspace. Existing Electron data was not changed. Check that this Windows user can unlock the native data folder.", "Orbit", MessageBoxButton.OK, MessageBoxImage.Error); Shutdown(1); }
    }
    protected override void OnExit(ExitEventArgs e) { single?.Dispose(); base.OnExit(e); }
}
