using System.Net.Http;
using System.Security.Cryptography;
using Orbit.Core;
namespace Orbit.Desktop;
internal static class NativeSmoke
{
    public static async Task Run(App app, string outputDirectory)
    {
        app.ShutdownMode = System.Windows.ShutdownMode.OnExplicitShutdown;
        var root = Path.Combine(Path.GetTempPath(), "orbit-native-smoke-" + Guid.NewGuid());
        Directory.CreateDirectory(root); Directory.CreateDirectory(outputDirectory);
        try
        {
            var protector = new DpapiProtector(); var secret = System.Text.Encoding.UTF8.GetBytes("synthetic-test-secret");
            var protectedBytes = protector.Protect(secret);
            if (protectedBytes.SequenceEqual(secret) || !protector.Unprotect(protectedBytes).SequenceEqual(secret)) throw new CryptographicException("DPAPI round trip failed.");
            if (PublisherVerifier.Roblox(Environment.ProcessPath!)) throw new InvalidDataException("Unsigned Orbit was incorrectly accepted as Roblox.");
            var store = new WorkspaceStore(root, protector);
            store.State.Accounts.Add(new() { Username = "Synthetic_CI_Record", UserId = 123, Group = "Testing" });
            await store.SaveAsync(); var loaded = new WorkspaceStore(root, protector); await loaded.LoadAsync();
            if (loaded.State.Accounts.Count != 1) throw new InvalidDataException("Protected store failed to reload.");
            using var http = new HttpClient(new RejectNetwork()); var window = new MainWindow(loaded, http);
            app.MainWindow = window; window.Show(); window.SmokeViews(outputDirectory); window.Close();
            await File.WriteAllTextAsync(Path.Combine(outputDirectory,"windows-smoke.txt"), "PASS: current-user DPAPI, protected store, wrong publisher rejection, six native WPF views rendered without network. Screenshots contain synthetic CI data.\n");
            app.Shutdown(0);
        }
        catch (Exception e)
        {
            await File.WriteAllTextAsync(Path.Combine(outputDirectory,"windows-smoke.txt"), "FAIL: " + e);
            app.Shutdown(1);
        }
        finally { Directory.Delete(root, true); }
    }
    private sealed class RejectNetwork : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => throw new InvalidOperationException("Smoke tests must not contact Roblox."); }
}
