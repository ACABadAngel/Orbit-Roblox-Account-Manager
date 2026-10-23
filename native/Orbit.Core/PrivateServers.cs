using System.Text.RegularExpressions;
namespace Orbit.Core;
public sealed record PrivateTarget(string AccessCode,string LinkCode="");
public static partial class PrivateServers
{
    [GeneratedRegex(@"^[a-zA-Z0-9_-]{8,256}$")]private static partial Regex Code();
    [GeneratedRegex(@"Roblox\.GameLauncher\.joinPrivateGame\(\d+,\s*['""]([a-zA-Z0-9_-]{8,256})['""]|data-private-server-access-code=['""]([a-zA-Z0-9_-]{8,256})['""]")]private static partial Regex Access();
    public static Uri ValidateLink(string target,string place)
    {
        if(!Uri.TryCreate(target,UriKind.Absolute,out var u)||u.Scheme!="https"||u.Host is not("www.roblox.com"or"roblox.com")||!u.IsDefaultPort||u.UserInfo.Length>0||!(u.AbsolutePath.StartsWith("/games/",StringComparison.Ordinal)||u.AbsolutePath=="/share"))throw new ArgumentException("Use a Roblox private-server link or access code.");
        var parts=u.AbsolutePath.Split('/');if(parts.Length>2&&parts[1]=="games"&&parts[2]!=place)throw new ArgumentException("This invite belongs to a different place.");return u;
    }
    public static async Task<PrivateTarget> Resolve(HttpClient http,PrivateServer server,string cookie,CancellationToken ct)
    {
        if(Code().IsMatch(server.Target))return new(server.Target);
        var uri=ValidateLink(server.Target,server.PlaceId);
        for(var i=0;i<5;i++)
        {
            ValidateLink(uri.AbsoluteUri,server.PlaceId);using var request=new HttpRequestMessage(HttpMethod.Get,uri);request.Headers.Add("Cookie",".ROBLOSECURITY="+cookie);
            using var response=await http.SendAsync(request,ct);
            if((int)response.StatusCode is 301 or 302 or 303 or 307 or 308){uri=new Uri(uri,response.Headers.Location??throw new InvalidDataException("Invalid Roblox invite redirect."));continue;}
            response.EnsureSuccessStatusCode();var html=await response.Content.ReadAsStringAsync(ct);if(html.Length>5_000_000)throw new InvalidDataException("Invite response too large.");
            var query=System.Web.HttpUtility.ParseQueryString(uri.Query);var link=query["privateServerLinkCode"]??"";var match=Access().Match(html);var access=match.Groups[1].Success?match.Groups[1].Value:match.Groups[2].Value;
            if(match.Success&&Code().IsMatch(link))return new(access,link);break;
        }
        throw new InvalidOperationException("Roblox did not resolve this invite. Check access or use a private-server access code.");
    }
    public static PrivateServer? Choose(Workspace state,Account account,GroupOptions config,Dictionary<string,int> cursors)
    {
        if(config.ServerMode=="none")return null;
        if(config.ServerMode=="assigned")return state.PrivateServers.FirstOrDefault(s=>s.Id==account.ServerId)??throw new InvalidOperationException("Assign a private server to this account first.");
        var servers=config.ServerIds.Select(id=>state.PrivateServers.FirstOrDefault(s=>s.Id==id)).Where(s=>s is not null).ToArray();if(servers.Length==0)throw new InvalidOperationException("Add a private-server pool for this group.");
        var cursor=cursors.GetValueOrDefault(account.Group);cursors[account.Group]=cursor+1;return servers[cursor%servers.Length];
    }
}
