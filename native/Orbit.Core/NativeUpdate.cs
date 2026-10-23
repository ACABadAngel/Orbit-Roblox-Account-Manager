using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
namespace Orbit.Core;
public sealed record UpdateOffer(string Tag,string Version,string Url,string HashUrl);
public static class NativeUpdate
{
    public static async Task<UpdateOffer?> Check(HttpClient http,Version current,string channel,CancellationToken ct)
    {
        using var request=new HttpRequestMessage(HttpMethod.Get,"https://api.github.com/repos/ACABadAngel/Orbit-Roblox-Account-Manager/releases?per_page=30");request.Headers.UserAgent.ParseAdd("Orbit-Native-Updater");using var response=await http.SendAsync(request,ct);response.EnsureSuccessStatusCode();var releases=await response.Content.ReadFromJsonAsync<JsonElement>(ct);
        foreach(var release in releases.EnumerateArray())
        {
            if(release.GetProperty("draft").GetBoolean()||channel=="stable"&&release.GetProperty("prerelease").GetBoolean())continue;var tag=release.GetProperty("tag_name").GetString()??"";if(!tag.StartsWith("native-v",StringComparison.Ordinal))continue;var version=tag[8..].Split('-')[0];if(!Version.TryParse(version,out var parsed)||parsed<=current)continue;
            var assets=release.GetProperty("assets").EnumerateArray().ToArray();var zip=assets.FirstOrDefault(a=>a.GetProperty("name").GetString()=="Orbit-Native-win-x64.zip");var hash=assets.FirstOrDefault(a=>a.GetProperty("name").GetString()=="Orbit-Native-win-x64.zip.sha256");if(zip.ValueKind==JsonValueKind.Undefined||hash.ValueKind==JsonValueKind.Undefined)continue;
            var offer=new UpdateOffer(tag,version,zip.GetProperty("browser_download_url").GetString()!,hash.GetProperty("browser_download_url").GetString()!);ValidateUrl(offer.Url);ValidateUrl(offer.HashUrl);return offer;
        }
        return null;
    }
    public static Uri ValidateUrl(string value)
    {if(!Uri.TryCreate(value,UriKind.Absolute,out var u)||u.Scheme!="https"||u.Host!="github.com"||!u.AbsolutePath.StartsWith("/ACABadAngel/Orbit-Roblox-Account-Manager/releases/download/",StringComparison.Ordinal))throw new InvalidDataException("Invalid Orbit update URL.");return u;}
    public static async Task<string> Download(HttpClient http,UpdateOffer offer,string folder,CancellationToken ct)
    {
        ValidateUrl(offer.Url);ValidateUrl(offer.HashUrl);Directory.CreateDirectory(folder);
        // The download-only client follows GitHub's signed asset redirects; never used for account cookies or pairing tokens.
        var expected=(await http.GetStringAsync(offer.HashUrl,ct)).Trim().Split(' ',StringSplitOptions.RemoveEmptyEntries)[0];if(expected.Length!=64||!expected.All(Uri.IsHexDigit))throw new InvalidDataException("Invalid update checksum.");
        var file=Path.Combine(folder,"Orbit-update.zip");using var response=await http.GetAsync(offer.Url,HttpCompletionOption.ResponseHeadersRead,ct);response.EnsureSuccessStatusCode();
        await using(var source=await response.Content.ReadAsStreamAsync(ct))await using(var target=File.Create(file)){var buffer=new byte[65536];long total=0;int count;while((count=await source.ReadAsync(buffer,ct))>0){total+=count;if(total>600_000_000)throw new InvalidDataException("Update archive too large.");await target.WriteAsync(buffer.AsMemory(0,count),ct);}}
        await using(var bytes=File.OpenRead(file)){var actual=Convert.ToHexString(await SHA256.HashDataAsync(bytes,ct));if(!actual.Equals(expected,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Orbit update checksum mismatch.");}return file;
    }
}
