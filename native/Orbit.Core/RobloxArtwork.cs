using System.Collections.Concurrent;
using System.Net.Http;
using System.Text.Json;

namespace Orbit.Core;

public sealed record GameArtwork(string Name, string Creator, byte[] Icon, byte[]? Thumbnail);

// Public metadata uses a separate, cookie-free HTTP client. Place IDs must be resolved
// to universe IDs before calling game thumbnail APIs; their IDs are not interchangeable.
public sealed class RobloxArtwork(HttpClient client, CancellationToken lifetime = default)
{
    private sealed record Entry(DateTimeOffset Expires, object Value);
    private readonly ConcurrentDictionary<string, Entry> cache = new();
    private readonly ConcurrentDictionary<string, Lazy<Task<object>>> pending = new();
    private readonly SemaphoreSlim downloads = new(4);
    public async Task<GameArtwork> Game(string placeId, CancellationToken ct = default) =>
        (GameArtwork)await Cached("game:" + PositiveId(placeId), async token =>
        {
            using var universe = await Json($"https://apis.roblox.com/universes/v1/places/{placeId}/universe", token);
            var id = universe.RootElement.GetProperty("universeId").GetInt64();
            if (id <= 0) throw new InvalidDataException("This place has no public experience.");
            using var details = await Json($"https://games.roblox.com/v1/games?universeIds={id}", token);
            var game = details.RootElement.GetProperty("data").EnumerateArray().FirstOrDefault(g => g.GetProperty("id").GetInt64() == id);
            var name = game.ValueKind == JsonValueKind.Undefined ? "Roblox experience" : game.GetProperty("name").GetString() ?? "Roblox experience";
            var creator = game.ValueKind == JsonValueKind.Undefined ? "" : game.GetProperty("creator").GetProperty("name").GetString() ?? "";
            var icon = await Thumbnail($"https://thumbnails.roblox.com/v1/games/icons?universeIds={id}&returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false", id, false, token);
            byte[]? wide = null;
            using var wideTimeout = CancellationTokenSource.CreateLinkedTokenSource(token); wideTimeout.CancelAfter(TimeSpan.FromSeconds(6));
            try { wide = await Thumbnail($"https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds={id}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false", id, true, wideTimeout.Token); }
            catch (Exception e) when (e is HttpRequestException or InvalidDataException or JsonException || e is OperationCanceledException && !token.IsCancellationRequested) { /* The icon remains a usable fallback. */ }
            return new GameArtwork(name, creator, icon, wide);
        }, ct);
    public async Task<byte[]> Avatar(long userId, CancellationToken ct = default) =>
        (byte[])await Cached("avatar:" + PositiveId(userId.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            async token => await Thumbnail($"https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={userId}&size=150x150&format=Png&isCircular=false", userId, false, token), ct);
    private static string PositiveId(string value) => long.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var id) && id > 0 ? value : throw new ArgumentException("Use a positive Roblox ID.");
    private async Task<object> Cached(string key, Func<CancellationToken, Task<object>> load, CancellationToken ct)
    {
        if (cache.TryGetValue(key, out var entry) && entry.Expires > DateTimeOffset.UtcNow) return entry.Value;
        var task = pending.GetOrAdd(key, ignoredKey => new Lazy<Task<object>>(async () =>
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime); timeout.CancelAfter(TimeSpan.FromSeconds(25));
            var result = await load(timeout.Token);
            if (cache.Count >= 256) foreach (var old in cache.OrderBy(p => p.Value.Expires).Take(32)) cache.TryRemove(old.Key, out _);
            cache[key] = new(DateTimeOffset.UtcNow.AddMinutes(30), result); return result;
        }));
        var running = task.Value;
        _ = running.ContinueWith(completed =>
        {
            _ = completed.Exception; // Observe errors even if every view was cancelled.
            pending.TryRemove(new KeyValuePair<string, Lazy<Task<object>>>(key, task));
        }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        return await running.WaitAsync(ct);
    }
    private async Task<byte[]> Thumbnail(string url, long id, bool wide, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            using var json = await Json(url, ct);
            var items = json.RootElement.GetProperty("data").EnumerateArray();
            var item = items.FirstOrDefault(x => x.TryGetProperty(wide ? "universeId" : "targetId", out var target) && target.GetInt64() == id);
            if (wide && item.ValueKind != JsonValueKind.Undefined) item = item.GetProperty("thumbnails").EnumerateArray().FirstOrDefault();
            if (item.ValueKind == JsonValueKind.Undefined) throw new InvalidDataException("No public image is available.");
            var state = item.GetProperty("state").GetString();
            if (state == "Completed")
            {
                var uri = ImageUri(item.GetProperty("imageUrl").GetString() ?? "");
                var bytes = await Read(uri.AbsoluteUri, 4_000_000, ct);
                if (!(bytes.Length > 8 && (bytes.AsSpan(0, 8).SequenceEqual(new byte[] {137,80,78,71,13,10,26,10}) || bytes[0] == 255 && bytes[1] == 216))) throw new InvalidDataException("Invalid thumbnail format.");
                return bytes;
            }
            if (state != "Pending" && state != "InReview") throw new InvalidDataException("This image is unavailable or moderated.");
            if (attempt < 2) await Task.Delay(TimeSpan.FromSeconds(1), ct);
        }
        throw new InvalidDataException("Roblox is still preparing this image. Retry shortly.");
    }
    public static Uri ImageUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || !uri.Host.EndsWith(".rbxcdn.com", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Untrusted Roblox image address.");
        return uri;
    }
    private async Task<JsonDocument> Json(string url, CancellationToken ct) => JsonDocument.Parse(await Read(url, 1_000_000, ct));
    private async Task<byte[]> Read(string url, int max, CancellationToken ct)
    {
        await downloads.WaitAsync(ct);
        try
        {
            using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct); response.EnsureSuccessStatusCode();
            if ((int)response.StatusCode >= 300 || response.Content.Headers.ContentLength > max) throw new InvalidDataException("Image response is too large or redirected.");
            await using var input = await response.Content.ReadAsStreamAsync(ct); using var output = new MemoryStream(); var buffer = new byte[16_384]; int read;
            while ((read = await input.ReadAsync(buffer, ct)) != 0) { if (output.Length + read > max) throw new InvalidDataException("Image response exceeds its size limit."); await output.WriteAsync(buffer.AsMemory(0, read), ct); }
            return output.ToArray();
        }
        finally { downloads.Release(); }
    }
}
