using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
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
            store.State.Profiles[0].PlaceId="123";store.State.Profiles[0].Name="Synthetic CI experience";
            await store.SaveAsync(); var loaded = new WorkspaceStore(root, protector); await loaded.LoadAsync();
            if (loaded.State.Accounts.Count != 1) throw new InvalidDataException("Protected store failed to reload.");
            using var http = new HttpClient(new RejectNetwork()); using var artworkHttp=new HttpClient(new ArtworkFixture()); var window = new MainWindow(loaded, http, smokeMode:true, artworkClient:artworkHttp);
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
            await window.SmokeViews(outputDirectory); if(window.LoadedGameImages==0)throw new InvalidDataException("Game artwork did not load into WPF."); window.Close();
            await File.WriteAllTextAsync(Path.Combine(outputDirectory,"windows-smoke.txt"), "PASS: current-user DPAPI, protected store, wrong publisher rejection, native WPF views and decoded game images, pinned HTTPS host/client, wrong-pin and wrong-token rejection. No external network. Screenshots contain synthetic CI data.\n");
            app.Shutdown(0);
        }
        catch (Exception e)
        {
            await File.WriteAllTextAsync(Path.Combine(outputDirectory,"windows-smoke.txt"), "FAIL: " + e);
            app.Shutdown(1);
        }
        finally { Directory.Delete(root, true); }
    }
    private sealed class ArtworkFixture : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            var path=request.RequestUri!.AbsolutePath;object body;
            if(request.RequestUri.Host.EndsWith(".rbxcdn.com"))
            {
                var visual=new DrawingVisual();using(var drawing=visual.RenderOpen()){drawing.DrawRectangle(new SolidColorBrush(Color.FromRgb(65,65,65)),null,new Rect(0,0,320,180));drawing.DrawEllipse(new SolidColorBrush(Color.FromRgb(130,130,130)),null,new Point(160,90),45,45);}
                var bitmap=new RenderTargetBitmap(320,180,96,96,PixelFormats.Pbgra32);bitmap.Render(visual);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using var output=new MemoryStream();encoder.Save(output);return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK){Content=new ByteArrayContent(output.ToArray())});
            }
            if(path.Contains("/places/"))body=new{universeId=456};
            else if(request.RequestUri.Host=="games.roblox.com")body=new{data=new[]{new{id=456,name="Synthetic CI experience",creator=new{name="Offline test fixture"}}}};
            else if(path.Contains("multiget"))body=new{data=new[]{new{universeId=456,thumbnails=new[]{new{state="Completed",imageUrl="https://tr.rbxcdn.com/fixture.png"}}}}};
            else body=new{data=new[]{new{targetId=path.Contains("avatar")?123:456,state="Completed",imageUrl="https://tr.rbxcdn.com/fixture.png"}}};
            return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK){Content=new StringContent(JsonSerializer.Serialize(body))});
        }
    }
    private sealed class RejectNetwork : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => throw new InvalidOperationException("Smoke tests must not contact Roblox."); }
}
