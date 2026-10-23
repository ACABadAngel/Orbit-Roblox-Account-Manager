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
        single = new Mutex(true, "Local\\OrbitNativeWorkspace", out var created);
        if (!created) { MessageBox.Show("Orbit Native is already open.", "Orbit"); Shutdown(); return; }
        try
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Orbit", "NativePreview");
            var store = new WorkspaceStore(root, new DpapiProtector()); await store.LoadAsync();
            var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false };
            var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(5) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("Orbit/0.6.0-CSharp-Preview");
            var window = new MainWindow(store, http); MainWindow = window; window.Show();
        }
        catch (Exception) { MessageBox.Show("Orbit could not open its native workspace. Existing Electron data was not changed. Check that this Windows user can unlock the native data folder.", "Orbit", MessageBoxButton.OK, MessageBoxImage.Error); Shutdown(1); }
    }
    protected override void OnExit(ExitEventArgs e) { single?.Dispose(); base.OnExit(e); }
}
