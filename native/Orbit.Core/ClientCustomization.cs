using System.Text.Json;
using System.Text.RegularExpressions;
namespace Orbit.Core;
public static partial class ClientCustomization
{
    [GeneratedRegex(@"^(?:DF|F)(?:Flag|Int|String|Log)[a-zA-Z0-9_]{1,150}$")] private static partial Regex FlagName();
    public static Dictionary<string, JsonElement> ParseFlags(string json)
    {
        if (json.Length > 1_000_000) throw new ArgumentException("FastFlag profile is too large.");
        var flags = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json) ?? throw new ArgumentException("Enter a JSON object.");
        if (flags.Count > 5000 || flags.Any(p => !FlagName().IsMatch(p.Key) || p.Value.ValueKind is not (JsonValueKind.String or JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False) || p.Value.GetRawText().Length > 4096)) throw new ArgumentException("Use valid FastFlag names with scalar values.");
        return flags;
    }
    public static async Task ApplyFlagsAsync(InstalledClient client, Dictionary<string, JsonElement> global, LaunchProfile? profile, CancellationToken ct)
    {
        var flags = new Dictionary<string, JsonElement>(global);
        if (profile is not null) foreach (var flag in profile.FastFlags) flags[flag.Key] = flag.Value;
        ParseFlags(JsonSerializer.Serialize(flags));
        var directory = Path.Combine(client.Directory, "ClientSettings"); Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, "ClientAppSettings.json");
        await File.WriteAllTextAsync(file + ".tmp", JsonSerializer.Serialize(flags, WorkspaceStore.Json), ct);
        File.Move(file + ".tmp", file, true);
    }
    private static readonly HashSet<string> ModExtensions = new(StringComparer.OrdinalIgnoreCase) { ".png", ".jpg", ".jpeg", ".dds", ".ttf", ".otf", ".ogg", ".mp3", ".wav" };
    public static async Task<int> ApplyModsAsync(string modFolder, InstalledClient client, CancellationToken ct)
    {
        if (!Directory.Exists(modFolder)) return 0;
        var files = Directory.GetFiles(modFolder, "*", SearchOption.AllDirectories);
        if (files.Length > 5000) throw new InvalidDataException("Too many mod files.");
        var entries = new List<(string From, string To)>(); long total = 0;
        foreach (var file in files)
        {
            var relative = Path.GetRelativePath(modFolder, file).Replace('\\', '/');
            if (!relative.StartsWith("content/", StringComparison.OrdinalIgnoreCase) && !relative.StartsWith("PlatformContent/pc/", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Mods must be inside content/ or PlatformContent/pc/.");
            if (!ModExtensions.Contains(Path.GetExtension(file))) throw new InvalidDataException("Only image, font and sound replacements are supported.");
            var info = new FileInfo(file); if (info.LinkTarget is not null || HasLinkedParent(info, modFolder)) throw new InvalidDataException("Mod links are not supported.");
            total += info.Length; if (total > 512_000_000) throw new InvalidDataException("Mods exceed 512 MB.");
            entries.Add((file, Deployment.SafePath(client.Directory, relative)));
        }
        foreach (var item in entries)
        {
            ct.ThrowIfCancellationRequested(); Directory.CreateDirectory(Path.GetDirectoryName(item.To)!);
            await using var source = File.OpenRead(item.From); await using var target = File.Create(item.To); await source.CopyToAsync(target, ct);
        }
        return entries.Count;
    }
    private static bool HasLinkedParent(FileInfo file, string root)
    {
        for (var parent = file.Directory; parent is not null; parent = parent.Parent)
        { if (parent.LinkTarget is not null) return true; if (Path.GetFullPath(parent.FullName) == Path.GetFullPath(root)) return false; }
        return true;
    }
}
