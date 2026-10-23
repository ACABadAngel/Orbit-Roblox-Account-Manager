using System.Text.RegularExpressions;
namespace Orbit.Core;
public static partial class LaunchUri
{
    [GeneratedRegex(@"^[1-9]\d{0,19}$")] private static partial Regex PlacePattern();
    [GeneratedRegex(@"^[a-zA-Z0-9-]{1,64}$")] private static partial Regex JobPattern();
    [GeneratedRegex(@"^[a-zA-Z0-9._~-]{1,8192}$")] private static partial Regex TicketPattern();
    public static void ValidateProfile(LaunchProfile p)
    {
        if (p.PlaceId.Length > 0 && !PlacePattern().IsMatch(p.PlaceId)) throw new ArgumentException("Enter a numeric Roblox place ID.");
        if (p.JobId.Length > 0 && !JobPattern().IsMatch(p.JobId)) throw new ArgumentException("Invalid server job ID.");
        if (string.IsNullOrWhiteSpace(p.Name) || p.Name.Length > 80) throw new ArgumentException("Use a profile name of 1–80 characters.");
    }
    public static string Build(string ticket, LaunchProfile profile, long? now = null, PrivateTarget? target = null)
    {
        ValidateProfile(profile);
        if (profile.PlaceId.Length == 0) throw new ArgumentException("Set a place ID in the launch profile first.");
        if (!TicketPattern().IsMatch(ticket)) throw new ArgumentException("Invalid authentication ticket.");
        var query = $"request={(profile.JobId.Length == 0 ? "RequestGame" : "RequestGameJob")}&placeId={profile.PlaceId}&isPlayTogetherGame=false";
        if (profile.JobId.Length > 0) query += "&gameId=" + Uri.EscapeDataString(profile.JobId);
        if(target is not null) { if(!Regex.IsMatch(target.AccessCode,@"^[a-zA-Z0-9_-]{8,256}$") || target.LinkCode.Length>0&&!Regex.IsMatch(target.LinkCode,@"^[a-zA-Z0-9_-]{8,256}$"))throw new ArgumentException("Invalid private-server code."); query="request=RequestPrivateGame&placeId="+profile.PlaceId+"&accessCode="+target.AccessCode; if(target.LinkCode.Length>0)query+="&linkCode="+target.LinkCode; }
        var url = Uri.EscapeDataString("https://assetgame.roblox.com/game/PlaceLauncher.ashx?" + query);
        return $"roblox-player:1+launchmode:play+gameinfo:{ticket}+launchtime:{now ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}+placelauncherurl:{url}+robloxLocale:en_us+gameLocale:en_us+channel:";
    }
}
