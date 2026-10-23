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
            using var http = new HttpClient(new RejectNetwork()); var window = new MainWindow(loaded, http, smokeMode:true);
            app.MainWindow = window; window.Show();
            var listener=new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback,0);listener.Start();loaded.State.Host.Port=((System.Net.IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();
            await using(var host=new RemoteHost(window,loaded))
            {
                await host.Start();var peer=new PairedMachine{Address="https://127.0.0.1:"+loaded.State.Host.Port,Fingerprint=host.Fingerprint,Token=loaded.State.Host.Token};
                using(var trusted=new MachineClient(peer)){var state=await trusted.State(default);if(state.Accounts.Length!=1)throw new InvalidDataException("Pinned host state failed.");}
                var wrong=new PairedMachine{Address=peer.Address,Fingerprint=new string('0',64),Token=peer.Token};
                try{using var untrusted=new MachineClient(wrong);await untrusted.State(default);throw new InvalidDataException("Wrong certificate was accepted.");}catch(HttpRequestException){}
                var rejected=new PairedMachine{Address=peer.Address,Fingerprint=peer.Fingerprint,Token=new string('1',64)};
                try{using var denied=new MachineClient(rejected);await denied.State(default);throw new InvalidDataException("Wrong token was accepted.");}catch(HttpRequestException){}
            }
            window.SmokeViews(outputDirectory); window.Close();
            await File.WriteAllTextAsync(Path.Combine(outputDirectory,"windows-smoke.txt"), "PASS: current-user DPAPI, protected store, wrong publisher rejection, native WPF views, pinned HTTPS host/client, wrong-pin and wrong-token rejection. No external network. Screenshots contain synthetic CI data.\n");
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
