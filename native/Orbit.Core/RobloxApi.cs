using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
namespace Orbit.Core;
public sealed class RobloxException(string message, bool pause = false, TimeSpan? cooldown = null) : Exception(message)
{
    public bool Pause { get; } = pause;
    public TimeSpan Cooldown { get; } = cooldown ?? TimeSpan.Zero;
}
public sealed record RobloxUser(long Id, string Name, string DisplayName);
public sealed class RobloxApi(HttpClient http)
{
    private DateTimeOffset cooldownUntil;
    private bool verificationRequired;
    public void ResumeAfterSignIn() => verificationRequired = false;
    private void CheckCooldown()
    { if (DateTimeOffset.UtcNow < cooldownUntil) throw new RobloxException("Roblox cooldown is still active. Wait before trying again.", true, cooldownUntil - DateTimeOffset.UtcNow); }
    private void Check(HttpResponseMessage r)
    {
        if (r.Headers.Contains("rblx-challenge-id")) { verificationRequired = true; throw new RobloxException("Verification required. Sign in through Roblox to continue.", true); }
        if (r.StatusCode == HttpStatusCode.TooManyRequests)
        {
            var wait = r.Headers.RetryAfter?.Delta ?? (r.Headers.RetryAfter?.Date - DateTimeOffset.UtcNow) ?? TimeSpan.FromMinutes(1);
            wait = wait > TimeSpan.FromMinutes(1) ? wait : TimeSpan.FromMinutes(1);
            cooldownUntil = DateTimeOffset.UtcNow + wait;
            throw new RobloxException("Roblox rate limit reached. Launch queue paused.", true, wait);
        }
        if (r.StatusCode == HttpStatusCode.Unauthorized) throw new RobloxException("Session expired. Sign in again.");
    }
    private static HttpRequestMessage Request(HttpMethod method, string url, string cookie)
    {
        if (cookie.Length is < 20 or > 8192 || cookie.Contains('\r') || cookie.Contains('\n') || cookie.Contains(';')) throw new ArgumentException("Invalid Roblox session.");
        var r = new HttpRequestMessage(method, url);
        r.Headers.Add("Cookie", ".ROBLOSECURITY=" + cookie);
        return r;
    }
    public async Task<RobloxUser> UserAsync(string cookie, CancellationToken ct)
    {
        CheckCooldown();
        using var req = Request(HttpMethod.Get, "https://users.roblox.com/v1/users/authenticated", cookie);
        using var r = await http.SendAsync(req, ct); Check(r); r.EnsureSuccessStatusCode();
        var user = await r.Content.ReadFromJsonAsync<RobloxUser>(WorkspaceStore.Json, ct);
        if (user is null || user.Id < 1 || string.IsNullOrWhiteSpace(user.Name)) throw new InvalidDataException("Invalid Roblox account response.");
        return user;
    }
    public async Task<string> TicketAsync(string cookie, string placeId, CancellationToken ct)
    {
        CheckCooldown();
        if (verificationRequired) throw new RobloxException("Launch queue is paused for Roblox verification. Reconnect the affected account after completing sign-in.", true);
        LaunchUri.ValidateProfile(new() { PlaceId = placeId });
        string? csrf = null;
        for (var i = 0; i < 2; i++)
        {
            using var req = Request(HttpMethod.Post, "https://auth.roblox.com/v1/authentication-ticket/", cookie);
            req.Headers.Referrer = new("https://www.roblox.com/games/" + placeId);
            if (csrf is not null) req.Headers.Add("X-CSRF-TOKEN", csrf);
            req.Content = JsonContent.Create(new { });
            using var r = await http.SendAsync(req, ct); Check(r);
            if (i == 0 && r.StatusCode == HttpStatusCode.Forbidden && r.Headers.TryGetValues("x-csrf-token", out var values)) { csrf = values.First(); continue; }
            if (r.StatusCode == HttpStatusCode.Forbidden) { verificationRequired = true; throw new RobloxException("Roblox denied the launch ticket. Review this account in Roblox sign-in.", true); }
            r.EnsureSuccessStatusCode();
            return r.Headers.TryGetValues("rbx-authentication-ticket", out var tickets) ? tickets.First() : throw new RobloxException("Roblox did not issue a launch ticket.");
        }
        throw new RobloxException("Ticket request failed.");
    }
    public static IReadOnlyList<string> ParseSessions(string input)
    {
        if (input.Length > 5_000_000) throw new ArgumentException("Import is limited to 5 MB.");
        var rows = input.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim()).Where(x => x.Length > 0).Distinct().ToList();
        if (rows.Count > 5000) throw new ArgumentException("Import is limited to 5,000 sessions.");
        var tokens = new List<string>();
        foreach (var row in rows)
        {
            var explicitCookie=System.Text.RegularExpressions.Regex.Match(row,@"(?:^|[\s,""'])\.ROBLOSECURITY\s*=\s*([^;\s""',]+)",System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            var fields=System.Text.RegularExpressions.Regex.Matches(row,@"""(?:[^"" ]|"""")*""|[^,\t]+") .Select(m=>m.Value.Trim().Trim('\"')).ToArray();
            var token=explicitCookie.Success?explicitCookie.Groups[1].Value:fields.FirstOrDefault(f=>f.StartsWith("_|WARNING:",StringComparison.Ordinal))??(fields.Length==1?fields[0]:"");
            if(token.Length is <20 or >8192 || token.Any(char.IsWhiteSpace)||token.Contains(';'))
            { if(tokens.Count==0 && row.Contains("cookie",StringComparison.OrdinalIgnoreCase))continue; throw new ArgumentException("A line contains no valid session. Use one session per line or an explicit cookie/CSV field."); }
            if(!tokens.Contains(token))tokens.Add(token);
        }
        return tokens;
    }
}
