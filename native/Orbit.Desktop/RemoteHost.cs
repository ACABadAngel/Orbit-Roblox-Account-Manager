using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Orbit.Core;
namespace Orbit.Desktop;
public sealed record RemoteAccount(string Id,string Label,string Status,bool Running);
public sealed record MachineSnapshot(string Name,RemoteAccount[] Accounts,bool AllowsInput,int Fps,int Height);
public sealed record RemoteCommand(string Action,string AccountId="",double X=0,double Y=0,int Key=0,bool Up=false,string Lease="",double Volume=1,bool Muted=false);
public sealed class RemoteHost(MainWindow main,WorkspaceStore store) : IAsyncDisposable
{
    private WebApplication? app;private X509Certificate2? cert;
    private readonly SemaphoreSlim streams=new(2);
    private readonly Dictionary<string,(DateTimeOffset At,int Count)> rates=[];
    public string Fingerprint=>cert is null?"":Convert.ToHexString(SHA256.HashData(cert.RawData));
    public async Task Start()
    {
        var settings=store.State.Host;
        if(settings.Token.Length!=64)settings.Token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        if(settings.Certificate.Length==0)
        {
            using var rsa=RSA.Create(2048);var req=new CertificateRequest("CN=Orbit Host",rsa,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false,false,0,true));req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature|X509KeyUsageFlags.KeyEncipherment,true));var usages=new OidCollection{new("1.3.6.1.5.5.7.3.1")};req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(usages,true));using var generated=req.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5),DateTimeOffset.UtcNow.AddYears(2));settings.Certificate=Convert.ToBase64String(generated.Export(X509ContentType.Pfx));
        }
        cert=X509CertificateLoader.LoadPkcs12(Convert.FromBase64String(settings.Certificate),null,X509KeyStorageFlags.UserKeySet);
        var builder=WebApplication.CreateSlimBuilder();builder.Logging.ClearProviders();builder.WebHost.ConfigureKestrel(k=>{k.Limits.MaxRequestBodySize=65536;k.Limits.MaxConcurrentConnections=12;k.Limits.RequestHeadersTimeout=TimeSpan.FromSeconds(10);k.Listen(settings.Lan?IPAddress.Any:IPAddress.Loopback,settings.Port,l=>l.UseHttps(cert));});
        app=builder.Build();app.UseWebSockets();
        app.Use(async(ctx,next)=>
        {
            ctx.Response.Headers.CacheControl="no-store";
            if(ctx.Request.Headers.ContainsKey("Origin")||!RemoteSecurity.TokenMatches(ctx.Request.Headers.Authorization.ToString(),"Bearer "+settings.Token)){ctx.Response.StatusCode=401;return;}
            lock(rates){var ip=ctx.Connection.RemoteIpAddress?.ToString()??"";var now=DateTimeOffset.UtcNow;var value=rates.GetValueOrDefault(ip);if(now-value.At>TimeSpan.FromSeconds(1))value=(now,0);value.Count++;rates[ip]=value;if(rates.Count>100)rates.Clear();if(value.Count>120){ctx.Response.StatusCode=429;return;}}
            try{await next(ctx);}catch(Exception e)when(e is not OutOfMemoryException){if(!ctx.Response.HasStarted){ctx.Response.StatusCode=400;await ctx.Response.WriteAsJsonAsync(new{error=e is OperationCanceledException?"Request cancelled.":e.Message});}}
        });
        app.MapGet("/v1/state",async()=>await main.Dispatcher.InvokeAsync(main.RemoteSnapshot));
        app.MapPost("/v1/command",async(HttpContext ctx)=>
        {var command=await ctx.Request.ReadFromJsonAsync<RemoteCommand>(ctx.RequestAborted)??throw new ArgumentException("Missing command.");var task=await main.Dispatcher.InvokeAsync(()=>main.RemoteAction(command,ctx.RequestAborted));return Results.Json(await task);});
        app.MapGet("/v1/frames/{id}",async(HttpContext ctx,string id)=>
        {
            if(!Guid.TryParse(id,out _)||!ctx.WebSockets.IsWebSocketRequest){ctx.Response.StatusCode=400;return;}
            if(!await streams.WaitAsync(0,ctx.RequestAborted)){ctx.Response.StatusCode=429;return;}
            try
            {
                using var ws=await ctx.WebSockets.AcceptWebSocketAsync();using var cancel=CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
                var receive=Task.Run(async()=>{try{var buffer=new byte[1];await ws.ReceiveAsync(buffer,cancel.Token);}catch(Exception e)when(e is WebSocketException or OperationCanceledException){}finally{cancel.Cancel();}});
                try
                {
                    while(!cancel.IsCancellationRequested&&ws.State==WebSocketState.Open)
                    {
                        var clock=Stopwatch.StartNew();var handle=await main.Dispatcher.InvokeAsync(()=>main.RemoteCaptureHandle(id));
                        var frame=await Task.Run(()=>GameCapture.Jpeg(handle,settings.StreamHeight),cancel.Token);
                        // Re-check ownership after capture so a reused HWND cannot leak another process’s frame.
                        if(handle!=await main.Dispatcher.InvokeAsync(()=>main.RemoteCaptureHandle(id)))break;
                        if(frame is null)throw new InvalidOperationException("This Roblox window cannot be captured. Use windowed mode.");
                        await ws.SendAsync(frame,WebSocketMessageType.Binary,true,cancel.Token);
                        var remaining=TimeSpan.FromSeconds(1d/settings.StreamFps)-clock.Elapsed;if(remaining>TimeSpan.Zero)await Task.Delay(remaining,cancel.Token);
                    }
                }
                catch(Exception e)when(e is WebSocketException or OperationCanceledException or InvalidOperationException){}
                finally{cancel.Cancel();ws.Abort();await receive;}
            }
            finally{streams.Release();}
        });
        await app.StartAsync();await store.SaveAsync();
    }
    public async ValueTask DisposeAsync(){if(app is not null){using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(5));await app.StopAsync(timeout.Token);await app.DisposeAsync();app=null;}cert?.Dispose();}
}
public sealed class MachineClient : IDisposable
{
    private readonly PairedMachine peer;private readonly HttpClient http;
    public MachineClient(PairedMachine peer)
    {
        this.peer=peer;RemoteSecurity.Address(peer.Address);var pin=RemoteSecurity.Fingerprint(peer.Fingerprint);
        var handler=new HttpClientHandler{AllowAutoRedirect=false,UseCookies=false,ServerCertificateCustomValidationCallback=(_,certificate,_,_)=>certificate is not null&&Convert.ToHexString(SHA256.HashData(certificate.RawData))==pin};http=new(handler){Timeout=TimeSpan.FromSeconds(40),MaxResponseContentBufferSize=1_000_000};http.DefaultRequestHeaders.Authorization=new("Bearer",peer.Token);
    }
    public async Task<MachineSnapshot> State(CancellationToken ct)=>await http.GetFromJsonAsync<MachineSnapshot>(new Uri(RemoteSecurity.Address(peer.Address),"/v1/state"),ct)??throw new InvalidDataException("Invalid machine state.");
    public async Task<JsonElement> Command(RemoteCommand command,CancellationToken ct)
    {using var response=await http.PostAsJsonAsync(new Uri(RemoteSecurity.Address(peer.Address),"/v1/command"),command,ct);if(!response.IsSuccessStatusCode)throw new InvalidOperationException("Host rejected this action. Check its input setting, session attachment and licence.");return await response.Content.ReadFromJsonAsync<JsonElement>(ct);}
    public async Task Stream(string id,Func<byte[],Task> frame,CancellationToken ct)
    {
        if(!Guid.TryParse(id,out _))throw new ArgumentException("Invalid account.");using var ws=new ClientWebSocket();ws.Options.RemoteCertificateValidationCallback=(_,certificate,_,_)=>certificate is not null&&Convert.ToHexString(SHA256.HashData(certificate.GetRawCertData()))==RemoteSecurity.Fingerprint(peer.Fingerprint);ws.Options.SetRequestHeader("Authorization","Bearer "+peer.Token);
        var url=new UriBuilder(new Uri(RemoteSecurity.Address(peer.Address),"/v1/frames/"+id)){Scheme="wss"};await ws.ConnectAsync(url.Uri,ct);var buffer=new byte[65536];
        while(!ct.IsCancellationRequested&&ws.State==WebSocketState.Open)
        {
            using var bytes=new MemoryStream();WebSocketReceiveResult result;
            do{result=await ws.ReceiveAsync(buffer,ct);if(result.MessageType==WebSocketMessageType.Close)return;if(result.MessageType!=WebSocketMessageType.Binary||bytes.Length+result.Count>4_000_000)throw new InvalidDataException("Invalid remote frame.");bytes.Write(buffer,0,result.Count);}while(!result.EndOfMessage);
            await frame(bytes.ToArray());
        }
        ws.Abort();
    }
    public void Dispose()=>http.Dispose();
}
