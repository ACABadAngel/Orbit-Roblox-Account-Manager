using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;
namespace Orbit.Core;
public sealed record Entitlement(string Plan,int Devices,DateTimeOffset Until,IReadOnlySet<string> Features)
{
    public static Entitlement Free=>new("free",0,DateTimeOffset.MaxValue,new HashSet<string>());
    public bool Has(string feature)=>DateTimeOffset.UtcNow<Until&&Features.Contains(feature);
}
public static class LicenseSignatures
{
    public const string KeyAuthPublic="5586b4bc69c7a4b487e4563a4cd96afd39140f919bd31cea7d1c6a1e8439422b";
    public static bool Verify(byte[] data,byte[] signature,Ed25519PublicKeyParameters key)
    {var verifier=new Ed25519Signer();verifier.Init(false,key);verifier.BlockUpdate(data,0,data.Length);return verifier.VerifySignature(signature);}
    public static JsonElement KeyAuth(byte[] body,string signature,string timestamp,DateTimeOffset now,string publicHex=KeyAuthPublic)
    {
        if(body.Length>300000||signature.Length!=128||!long.TryParse(timestamp,out var seconds)||Math.Abs(now.ToUnixTimeSeconds()-seconds)>25||!Verify([..Encoding.ASCII.GetBytes(timestamp),..body],Convert.FromHexString(signature),new(Convert.FromHexString(publicHex),0)))throw new InvalidDataException("KeyAuth signature or timestamp was invalid.");
        using var doc=JsonDocument.Parse(body);return doc.RootElement.Clone();
    }
    public static JsonElement Receipt(string receipt,string publicPem,string device,DateTimeOffset now)
    {
        if(receipt.Length>15000)throw new InvalidDataException("Receipt too large.");var parts=receipt.Split('.');if(parts.Length!=2)throw new InvalidDataException("Invalid receipt.");
        var key=PublicKeyFactory.CreateKey(Convert.FromBase64String(publicPem.Replace("-----BEGIN PUBLIC KEY-----","").Replace("-----END PUBLIC KEY-----","").Replace("\r","").Replace("\n","")))as Ed25519PublicKeyParameters??throw new InvalidDataException("Use an Ed25519 service verification key.");
        static byte[] Decode(string x)=>Convert.FromBase64String(x.Replace('-','+').Replace('_','/')+new string('=',(4-x.Length%4)%4));
        if(!Verify(Encoding.ASCII.GetBytes(parts[0]),Decode(parts[1]),key))throw new InvalidDataException("Activation signature did not match.");
        using var doc=JsonDocument.Parse(Decode(parts[0]));var d=doc.RootElement;
        var issued=d.GetProperty("issuedAt").GetInt64();var until=d.GetProperty("offlineUntil").GetInt64();var ms=now.ToUnixTimeMilliseconds();
        if(d.GetProperty("issuer").GetString()!="orbit-license-v1"||d.GetProperty("deviceId").GetString()!=device||issued>ms+300000||until<=ms||until>issued+3*86400000L||(d.TryGetProperty("expiresAt",out var expiry)&&expiry.ValueKind!=JsonValueKind.Null&&expiry.GetInt64()<=ms))throw new InvalidDataException("Activation expired or belongs to a different installation.");return d.Clone();
    }
    public static Entitlement WithOverrides(Entitlement grant,IReadOnlyDictionary<string,bool> overrides)
    {var features=grant.Features.ToHashSet();foreach(var pair in overrides){if(pair.Key is not("remoteControl"or"advancedSchedules"or"workflows"or"extendedHistory"or"alerts"or"crossMachineBulk"))throw new InvalidDataException("Unknown licence feature.");if(pair.Value)features.Add(pair.Key);else features.Remove(pair.Key);}return grant with{Features=features};}
    public static Entitlement Grant(string plan,int? deviceOverride,DateTimeOffset until,IEnumerable<string>? additional=null)
    {
        var features=new HashSet<string>();if(plan is not("free"or"plus"or"pro"))throw new InvalidDataException("Unknown plan.");
        if(plan is "plus"or"pro")foreach(var f in new[]{"remoteControl","advancedSchedules","workflows","extendedHistory","alerts"})features.Add(f);
        if(plan=="pro")features.Add("crossMachineBulk");if(additional is not null)foreach(var f in additional)features.Add(f);
        var devices=deviceOverride??(plan=="pro"?5:plan=="plus"?2:0);if(devices is <0 or >100)throw new InvalidDataException("Invalid peer limit.");return new(plan,devices,until,features);
    }
}
public sealed class LicenseService(HttpClient http,WorkspaceStore store)
{
    private Entitlement grant=Entitlement.Free;private string session="";private DateTimeOffset verifiedUntil;private DateTimeOffset checkedAt;private DateTimeOffset retryAt;
    private readonly SemaphoreSlim gate=new(1);
    public string Error {get;private set;}="";
    public Entitlement Status
    {
        get
        {
            var o=store.State.License;
            if(o.Provider=="self-hosted"&&o.Receipt.Length>0)
            {
                try
                {if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()<o.LastSeenAt-300000)throw new InvalidDataException();var d=LicenseSignatures.Receipt(o.Receipt,o.PublicKey,o.DeviceId,DateTimeOffset.UtcNow);var overrides=d.GetProperty("features").EnumerateObject().ToDictionary(p=>p.Name,p=>p.Value.GetBoolean());return LicenseSignatures.WithOverrides(LicenseSignatures.Grant(d.GetProperty("plan").GetString()!,d.GetProperty("maxDevices").GetInt32(),DateTimeOffset.FromUnixTimeMilliseconds(d.GetProperty("offlineUntil").GetInt64())),overrides);}
                catch(Exception e)when(e is not OutOfMemoryException){return Entitlement.Free;}
            }
            return verifiedUntil!=default&&checkedAt!=default&&DateTimeOffset.UtcNow<verifiedUntil&&DateTimeOffset.UtcNow>=checkedAt.AddSeconds(-5)&&DateTimeOffset.UtcNow<grant.Until?grant:Entitlement.Free;
        }
    }
    public void Require(string feature){if(!Status.Has(feature))throw new InvalidOperationException("This feature needs an active Plus or Pro licence. Open Account & Licence.");}
    public void Clear(){grant=Entitlement.Free;verifiedUntil=default;session="";var o=store.State.License;o.Key="";o.Receipt="";Error="";}
    public async Task Refresh(CancellationToken ct)
    {
        if(store.State.License.Key.Length==0)return;
        if(!await gate.WaitAsync(0,ct))return;
        try{await Authenticate(store.State.License.Key,ct);Error="";}
        catch(Exception e)when(e is not OperationCanceledException){grant=Entitlement.Free;verifiedUntil=default;session="";Error=e.Message;}
        finally{gate.Release();}
    }
    public async Task Activate(string key,CancellationToken ct)
    {
        if(key.Length is <1 or >120||key.Any(char.IsControl))throw new ArgumentException("Enter a complete licence key.");
        await gate.WaitAsync(ct);try{await Authenticate(key,ct);store.State.License.Key=key;await store.SaveAsync();Error="";}finally{gate.Release();}
    }
    private async Task Authenticate(string key,CancellationToken ct)
    {
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(15));ct=timeout.Token;
        var o=store.State.License;
        if(o.Provider=="self-hosted")
        {
            var origin=ServiceOrigin(o.Endpoint);using var req=new HttpRequestMessage(HttpMethod.Post,new Uri(origin,"/v1/activate"));req.Headers.Authorization=new("Bearer",key);req.Content=JsonContent.Create(new{deviceId=o.DeviceId,deviceName=Environment.MachineName});
            using var response=await http.SendAsync(req,ct);if(!response.IsSuccessStatusCode){if(response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound)o.Receipt="";throw new InvalidOperationException("Licence service rejected activation.");}
            var result=await response.Content.ReadFromJsonAsync<JsonElement>(ct);var receipt=result.GetProperty("receipt").GetString()!;LicenseSignatures.Receipt(receipt,o.PublicKey,o.DeviceId,DateTimeOffset.UtcNow);o.Receipt=receipt;o.LastSeenAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();return;
        }
        if(string.IsNullOrWhiteSpace(o.AppName)||o.AppName.Length>100||o.OwnerId.Length!=10||!o.OwnerId.All(char.IsAsciiLetterOrDigit))throw new InvalidOperationException("Configure your KeyAuth application name and 10-character owner ID first.");
        if(session.Length==0){var init=await Api("init",new(){{"ver",o.AppVersion}},ct);session=init.GetProperty("sessionid").GetString()??"";if(session.Length is <1 or >256)throw new InvalidDataException("Invalid KeyAuth session.");}
        var hwid=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("orbit:keyauth:"+o.DeviceId))).ToLowerInvariant();
        var data=await Api("license",new(){{"key",key},{"hwid",hwid},{"sessionid",session}},ct);var info=data.GetProperty("info");if(info.GetProperty("hwid").GetString()!=hwid)throw new InvalidDataException("KeyAuth did not verify this installation. Enable HWID binding for the application.");
        var active=info.GetProperty("subscriptions").EnumerateArray().Where(s=>long.TryParse(s.GetProperty("expiry").ToString(),out var exp)&&exp>DateTimeOffset.UtcNow.ToUnixTimeSeconds()).ToArray();
        var known=active.Where(s=>s.GetProperty("subscription").GetString() is "free"or"plus"or"pro"or"remoteControl"or"workflows"or"advancedSchedules"or"extendedHistory"or"alerts"or"crossMachineBulk").ToArray();if(known.Length==0)throw new InvalidDataException("No active Orbit subscription was found.");
        var names=known.Select(s=>s.GetProperty("subscription").GetString()!).ToHashSet();var plan=names.Contains("pro")?"pro":names.Contains("plus")?"plus":"free";
        grant=LicenseSignatures.Grant(plan,plan=="free"&&names.Contains("remoteControl")?2:null,DateTimeOffset.FromUnixTimeSeconds(known.Min(s=>long.Parse(s.GetProperty("expiry").ToString()))),names);checkedAt=DateTimeOffset.UtcNow;verifiedUntil=checkedAt.AddSeconds(60);
    }
    private async Task<JsonElement> Api(string type,Dictionary<string,string> fields,CancellationToken ct)
    {
        if(DateTimeOffset.UtcNow<retryAt)throw new InvalidOperationException("KeyAuth cooldown is active. Try again later.");
        fields["type"]=type;fields["name"]=store.State.License.AppName;fields["ownerid"]=store.State.License.OwnerId;
        using var req=new HttpRequestMessage(HttpMethod.Post,"https://keyauth.win/api/1.3/"){Content=new FormUrlEncodedContent(fields)};using var response=await http.SendAsync(req,ct);
        if(response.StatusCode==HttpStatusCode.TooManyRequests){retryAt=DateTimeOffset.UtcNow.AddMinutes(1);throw new InvalidOperationException("KeyAuth rate limit reached.");}
        response.EnsureSuccessStatusCode();var bytes=await response.Content.ReadAsByteArrayAsync(ct);
        var signed=LicenseSignatures.KeyAuth(bytes,response.Headers.GetValues("x-signature-ed25519").First(),response.Headers.GetValues("x-signature-timestamp").First(),DateTimeOffset.UtcNow);
        if(signed.TryGetProperty("ownerid",out var owner)&&owner.GetString()!=store.State.License.OwnerId)throw new InvalidDataException("KeyAuth owner mismatch.");if(!signed.GetProperty("success").GetBoolean())throw new InvalidOperationException("KeyAuth rejected the key or application settings. Review expiry, HWID and version.");return signed;
    }
    public static Uri ServiceOrigin(string value)
    {if(!Uri.TryCreate(value,UriKind.Absolute,out var u)||!(u.Scheme=="https"||u.Scheme=="http"&&u.IsLoopback)||u.UserInfo.Length>0||u.AbsolutePath!="/"||u.Query.Length>0||u.Fragment.Length>0)throw new ArgumentException("Use an HTTPS service origin (or localhost for testing).");return u;}
}
