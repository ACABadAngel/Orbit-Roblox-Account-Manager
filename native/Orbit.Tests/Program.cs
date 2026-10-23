using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Orbit.Core;

var tests = new List<(string Name, Func<Task> Run)>();
void Test(string name, Func<Task> run) => tests.Add((name, run));
void Sync(string name, Action run) => Test(name, () => { run(); return Task.CompletedTask; });
static void Assert(bool value, string reason = "Assertion failed") { if (!value) throw new Exception(reason); }
static void Reject(Action action) { try { action(); } catch (Exception e) when (e is ArgumentException or InvalidDataException) { return; } throw new Exception("Unsafe input was accepted."); }
static async Task RejectAsync(Func<Task> action) { try { await action(); } catch (Exception e) when (e is InvalidDataException or IOException or OperationCanceledException) { return; } throw new Exception("Unsafe operation was accepted."); }
static byte[] Zip(params (string Name, string Value)[] entries)
{
    using var stream = new MemoryStream();
    using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true)) foreach (var e in entries) { var file = zip.CreateEntry(e.Name); using var writer = new StreamWriter(file.Open()); writer.Write(e.Value); }
    return stream.ToArray();
}
static string Temporary() { var d = Path.Combine(Path.GetTempPath(), "orbit-test-" + Guid.NewGuid()); Directory.CreateDirectory(d); return d; }
static string Manifest(byte[] zip, long size, string name = "RobloxApp.zip") => $"v0\n{name}\n{Convert.ToHexString(MD5.HashData(zip))}\n{zip.Length}\n{size}\n";
const string version = "version-1234567890abcdef";

Sync("launch URI encodes job and rejects ticket injection", () =>
{
    var uri = LaunchUri.Build("ticket", new() { PlaceId = "123", JobId = "server-12" }, 1234);
    Assert(uri.StartsWith("roblox-player:1+launchmode:play+gameinfo:ticket+launchtime:1234"));
    Assert(Uri.UnescapeDataString(uri).Contains("request=RequestGameJob&placeId=123&isPlayTogetherGame=false&gameId=server-12"));
    Reject(() => LaunchUri.Build("ticket+gameinfo:injected", new() { PlaceId = "123" }));
    Reject(() => LaunchUri.Build("ticket", new() { PlaceId = "../bad" }));
    Reject(() => LaunchUri.Build("ticket", new() { PlaceId = "123", JobId = "x&request=Bad" }));
});
Sync("manifest parses known packages and skips legacy launcher", () =>
{
    var list = Deployment.ParseManifest("v0\nRobloxApp.zip\n" + new string('a', 32) + "\n10\n20\nRobloxPlayerLauncher.exe\n" + new string('b', 32) + "\n10\n20\n");
    Assert(list.Count == 1 && list[0].Name == "RobloxApp.zip");
});
Sync("manifest rejects unknown, duplicate, truncated and oversized entries", () =>
{
    Reject(() => Deployment.ParseManifest("v1\n"));
    Reject(() => Deployment.ParseManifest("v0\nRobloxApp.zip\nbad\n1\n2\n"));
    Reject(() => Deployment.ParseManifest("v0\nRobloxApp.zip\n" + new string('a',32) + "\n10\n"));
    var good = "RobloxApp.zip\n" + new string('a',32) + "\n10\n20\n";
    Reject(() => Deployment.ParseManifest("v0\n" + good + good));
    Reject(() => Deployment.ParseManifest("v0\n" + good.Replace("RobloxApp.zip", "unknown.zip")));
    Reject(() => Deployment.ParseManifest("v0\n" + good.Replace("\n20\n", "\n4000000001\n")));
});
Sync("paths reject Unix, Windows, drive, ADS and traversal escapes", () =>
{
    var root = Temporary();
    try
    {
        foreach (var path in new[] { "../escape", "a/../../escape", "a\\..\\..\\escape", "C:\\evil", "/tmp/evil", "\\\\host\\file", "image.png:script", "a./evil", "folder /evil", "NUL", "folder/COM1.txt", "CON/image.png", "wild*.txt" }) Reject(() => Deployment.SafePath(root, path));
        Assert(Deployment.SafePath(root, "content/fonts/font.ttf").StartsWith(root));
        Reject(() => Deployment.ValidateChannel("live/../../evil")); Reject(() => Deployment.ValidateVersion("version-../../evil"));
    }
    finally { Directory.Delete(root, true); }
});
Test("archive traversal and size bombs do not escape staging", async () =>
{
    var root = Temporary();
    try
    {
        using var traversal = new MemoryStream(Zip(("../escaped.txt", "evil")));
        await RejectAsync(() => Deployment.ExtractAsync(traversal, root, 4, default));
        using var oversized = new MemoryStream(Zip(("safe.txt", "oversized")));
        await RejectAsync(() => Deployment.ExtractAsync(oversized, root, 1, default));
        Assert(!File.Exists(Path.Combine(Path.GetDirectoryName(root)!, "escaped.txt")));
    }
    finally { Directory.Delete(root, true); }
});
Test("valid archives preserve bytes and subdirectories", async () =>
{
    var root = Temporary();
    try { using var input = new MemoryStream(Zip(("nested/test.txt", "hello"))); await Deployment.ExtractAsync(input, root, 5, default); Assert(await File.ReadAllTextAsync(Path.Combine(root, "nested/test.txt")) == "hello"); }
    finally { Directory.Delete(root, true); }
});
Test("installer commits only a complete verified client", async () =>
{
    var root = Temporary(); var zip = Zip(("RobloxPlayerBeta.exe", "official-player")); var requests = new List<string>();
    using var client = new HttpClient(new FakeHttp(req =>
    {
        var url = req.RequestUri!.AbsoluteUri; requests.Add(url);
        if (url.Contains("client-version")) return Json(new { version = "0.1", clientVersionUpload = version });
        if (url.EndsWith("rbxPkgManifest.txt")) return TextResponse(Manifest(zip, 15));
        return new(HttpStatusCode.OK) { Content = new ByteArrayContent(zip) };
    }));
    try
    {
        var verified = false; var installer = new RobloxInstaller(client, root, file => { verified = File.ReadAllText(file) == "official-player"; return verified; });
        var result = await installer.EnsureAsync("live", true, false, null, default);
        Assert(verified && installer.Current()?.Version == version && File.Exists(result.Executable));
        Assert(requests.All(x => x.StartsWith("https://setup.rbxcdn.com/") || x.StartsWith("https://clientsettingscdn.roblox.com/")));
        Assert(!Directory.GetDirectories(Path.Combine(root, "versions")).Any(x => Path.GetFileName(x).StartsWith(".install-")));
        var n = requests.Count; await installer.EnsureAsync("live", false, false, null, default); Assert(n == requests.Count, "Pinned/offline launch unexpectedly fetched a new build.");
    }
    finally { Directory.Delete(root, true); }
});
Test("signature failure preserves previous active client", async () =>
{
    var root = Temporary(); var zip = Zip(("RobloxPlayerBeta.exe", "bad"));
    using var client = new HttpClient(new FakeHttp(req => req.RequestUri!.AbsolutePath.Contains("client-version") ? Json(new { version = "0.1", clientVersionUpload = version }) : req.RequestUri.AbsolutePath.EndsWith("rbxPkgManifest.txt") ? TextResponse(Manifest(zip, 3)) : new(HttpStatusCode.OK) { Content = new ByteArrayContent(zip) }));
    try
    {
        var previous = "version-abcdef1234567890"; var dir = Path.Combine(root, "versions", previous); Directory.CreateDirectory(dir); File.WriteAllText(Path.Combine(dir, "RobloxPlayerBeta.exe"), "old"); File.WriteAllText(Path.Combine(root, "current.txt"), previous);
        var installer = new RobloxInstaller(client, root, _ => false);
        await RejectAsync(() => installer.EnsureAsync("live", true, false, null, default));
        Assert(installer.Current()?.Version == previous && File.ReadAllText(Path.Combine(dir, "RobloxPlayerBeta.exe")) == "old");
        Assert(!Directory.Exists(Path.Combine(root, "versions", version)));
    }
    finally { Directory.Delete(root, true); }
});
Test("checksum failure never publishes downloaded executable", async () =>
{
    var root = Temporary(); var zip = Zip(("RobloxPlayerBeta.exe", "bad"));
    using var client = new HttpClient(new FakeHttp(req => req.RequestUri!.AbsolutePath.Contains("client-version") ? Json(new { version = "0.1", clientVersionUpload = version }) : req.RequestUri.AbsolutePath.EndsWith("rbxPkgManifest.txt") ? TextResponse(Manifest(zip, 3).Replace(Convert.ToHexString(MD5.HashData(zip)), new string('0',32))) : new(HttpStatusCode.OK) { Content = new ByteArrayContent(zip) }));
    try { var installer = new RobloxInstaller(client, root, _ => true); await RejectAsync(() => installer.EnsureAsync("live", true, false, null, default)); Assert(installer.Current() is null); }
    finally { Directory.Delete(root, true); }
});
Test("cancelled install does not touch current pointer", async () =>
{
    var root = Temporary(); using var ct = new CancellationTokenSource(); ct.Cancel(); using var client = new HttpClient(new FakeHttp(_ => throw new Exception("Unexpected network call")));
    try { await RejectAsync(() => new RobloxInstaller(client, root, _ => true).EnsureAsync("live", true, false, null, ct.Token)); Assert(!File.Exists(Path.Combine(root,"current.txt"))); }
    finally { Directory.Delete(root, true); }
});
Sync("FastFlag JSON accepts scalar values and rejects script-shaped data", () =>
{
    Assert(ClientCustomization.ParseFlags("{\"FFlagExample\":true,\"DFIntExample\":60}").Count == 2);
    foreach (var bad in new[] { "[]", "{\"unrelated\":true}", "{\"FFlagExample\":{\"nested\":true}}", "{\"FFlagExample\":[1]}" })
    { try { ClientCustomization.ParseFlags(bad); } catch (Exception e) when (e is ArgumentException or JsonException) { continue; } throw new Exception("Invalid flag profile accepted"); }
});
Test("profile FastFlags override globals without mutating global settings", async () =>
{
    var root = Temporary();
    try
    {
        var global = ClientCustomization.ParseFlags("{\"DFIntExample\":30}"); var p = new LaunchProfile { FastFlags = ClientCustomization.ParseFlags("{\"DFIntExample\":60}") };
        await ClientCustomization.ApplyFlagsAsync(new(version, root), global, p, default);
        var flags = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root,"ClientSettings","ClientAppSettings.json")));
        Assert(flags.RootElement.GetProperty("DFIntExample").GetInt32() == 60 && global["DFIntExample"].GetInt32() == 30);
    }
    finally { Directory.Delete(root, true); }
});
Test("content mods reject binaries and leave Player untouched", async () =>
{
    var root = Temporary(); var mods = Path.Combine(root, "Mods"); Directory.CreateDirectory(mods); File.WriteAllText(Path.Combine(mods,"RobloxPlayerBeta.exe"),"bad");
    try { await RejectAsync(() => ClientCustomization.ApplyModsAsync(mods, new(version, Path.Combine(root,"client")), default)); Assert(!Directory.Exists(Path.Combine(root,"client"))); }
    finally { Directory.Delete(root, true); }
});
Test("content mods copy image replacements into approved folders", async () =>
{
    var root = Temporary(); var mods = Path.Combine(root, "Mods"); Directory.CreateDirectory(Path.Combine(mods,"content/textures")); File.WriteAllText(Path.Combine(mods,"content/textures/cursor.png"),"pixels");
    try { var client = Path.Combine(root,"client"); Assert(await ClientCustomization.ApplyModsAsync(mods, new(version,client),default) == 1); Assert(File.ReadAllText(Path.Combine(client,"content/textures/cursor.png")) == "pixels"); }
    finally { Directory.Delete(root, true); }
});
Test("account validation detects wrong identity and expired session", async () =>
{
    using var client = new HttpClient(new FakeHttp(req => { Assert(req.Headers.GetValues("Cookie").Single().StartsWith(".ROBLOSECURITY=")); return Json(new { id = 123, name = "Test", displayName = "Test User" }); }));
    var user = await new RobloxApi(client).UserAsync(new string('a',30), default); Assert(user.Id == 123 && user.Name == "Test");
    using var expired = new HttpClient(new FakeHttp(_ => new(HttpStatusCode.Unauthorized)));
    try { await new RobloxApi(expired).UserAsync(new string('a',30),default); } catch (RobloxException e) { Assert(e.Message.Contains("expired")); return; } throw new Exception("Expired session accepted");
});
Test("ticket handshake retries once with CSRF and never follows verification", async () =>
{
    var calls = 0;
    using var client = new HttpClient(new FakeHttp(req =>
    {
        calls++; Assert(req.RequestUri!.Host == "auth.roblox.com");
        if (calls == 1) { var forbidden = new HttpResponseMessage(HttpStatusCode.Forbidden); forbidden.Headers.Add("x-csrf-token", "csrf-value"); return forbidden; }
        Assert(req.Headers.GetValues("X-CSRF-TOKEN").Single() == "csrf-value"); var ok = new HttpResponseMessage(HttpStatusCode.OK); ok.Headers.Add("rbx-authentication-ticket", "ticket"); return ok;
    }));
    Assert(await new RobloxApi(client).TicketAsync(new string('a',30),"123",default) == "ticket" && calls == 2);
});
Test("rate limit and challenge stop ticket attempts", async () =>
{
    foreach (var challenge in new[] { false, true })
    {
        var calls = 0;
        using var client = new HttpClient(new FakeHttp(_ => { calls++; var r = new HttpResponseMessage(challenge ? HttpStatusCode.Forbidden : HttpStatusCode.TooManyRequests); if(challenge) r.Headers.Add("rblx-challenge-id","challenge"); else r.Headers.RetryAfter = new(TimeSpan.FromSeconds(2)); return r; }));
        try { await new RobloxApi(client).TicketAsync(new string('a',30),"123",default); } catch (RobloxException e) { Assert(e.Pause && calls == 1); if(!challenge) Assert(e.Cooldown >= TimeSpan.FromMinutes(1)); continue; } throw new Exception("Queue did not pause");
    }
});
Test("protected workspace round trips secrets and excludes runtime handles", async () =>
{
    var root = Temporary(); var protector = new TestProtector();
    try
    {
        var store = new WorkspaceStore(root, protector); var a = new Account { Username = "Test", UserId = 123, Window = 12345, ProcessId = 100 }; store.State.Accounts.Add(a); store.PutSession(a.Id,"private-session"); await store.SaveAsync();
        Assert(!Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(root,"workspace.dpapi"))).Contains("private-session"));
        var reload = new WorkspaceStore(root,protector); await reload.LoadAsync(); Assert(reload.Session(a.Id) == "private-session" && reload.State.Accounts.Single().Window == 0);
        reload.State.Accounts.Single().Alias = "Second"; await reload.SaveAsync();
        File.WriteAllText(Path.Combine(root,"workspace.dpapi"),"corrupted");
        var recovered = new WorkspaceStore(root,protector); await recovered.LoadAsync(); Assert(recovered.Session(a.Id) == "private-session" && recovered.State.Accounts.Single().Alias == "");
        Assert(Directory.GetFiles(root,"*.damaged-*").Length == 1);
    }
    finally { Directory.Delete(root, true); }
});
Test("damaged workspace without a good backup is never replaced", async () =>
{
    var root = Temporary();
    try
    {
        var file = Path.Combine(root,"workspace.dpapi"); await File.WriteAllTextAsync(file,"do-not-overwrite");
        await RejectAsync(() => new WorkspaceStore(root,new TestProtector()).LoadAsync()); Assert(await File.ReadAllTextAsync(file) == "do-not-overwrite");
    }
    finally { Directory.Delete(root, true); }
});
Test("cooldown persists across repeated launch attempts", async () =>
{
    var calls = 0; using var client = new HttpClient(new FakeHttp(_ => { calls++; return new(HttpStatusCode.TooManyRequests); }));
    var api = new RobloxApi(client);
    for (var i = 0; i < 2; i++) { try { await api.TicketAsync(new string('a',30),"123",default); } catch (RobloxException e) { Assert(e.Pause); } }
    Assert(calls == 1, "Rate limit was bypassed by a new launch request.");
});
Sync("workspace rejects duplicate accounts and invalid settings", () =>
{
    var a = new Account { UserId = 1, Username = "Test" }; var s = new Workspace(); s.Accounts.Add(a); s.Accounts.Add(a); Reject(s.Validate);
    s = new(); s.Launcher.LaunchDelaySeconds = 121; Reject(s.Validate);
});

ExtendedTests.Register(Test);
var failed = 0;
foreach (var test in tests) { try { await test.Run(); Console.WriteLine("PASS " + test.Name); } catch(Exception e) { failed++; Console.Error.WriteLine($"FAIL {test.Name}: {e.GetType().Name}: {e.Message}"); } }
Console.WriteLine($"{tests.Count - failed}/{tests.Count} native core checks passed.");
return failed == 0 ? 0 : 1;

static HttpResponseMessage Json<T>(T value) => TextResponse(JsonSerializer.Serialize(value));
static HttpResponseMessage TextResponse(string text) => new(HttpStatusCode.OK) { Content = new StringContent(text) };
sealed class FakeHttp(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{ protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) { cancellationToken.ThrowIfCancellationRequested(); return Task.FromResult(respond(request)); } }
sealed class TestProtector : ISecretProtector
{
    private readonly byte[] key = RandomNumberGenerator.GetBytes(32);
    public byte[] Protect(byte[] data)
    { var nonce = RandomNumberGenerator.GetBytes(12); var tag = new byte[16]; var cipher = new byte[data.Length]; using var aes = new AesGcm(key,16); aes.Encrypt(nonce,data,cipher,tag); return [..nonce,..tag,..cipher]; }
    public byte[] Unprotect(byte[] data)
    { if (data.Length < 28) throw new InvalidDataException("Truncated test envelope"); var plain = new byte[data.Length-28]; using var aes = new AesGcm(key,16); aes.Decrypt(data.AsSpan(0,12), data.AsSpan(28), data.AsSpan(12,16), plain); return plain; }
}
