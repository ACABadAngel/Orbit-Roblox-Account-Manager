using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.IO.Compression;

namespace Orbit.Core;
public sealed record ClientVersion(string Version, string ClientVersionUpload);
public sealed record Package(string Name, string Md5, long PackedSize, long UnpackedSize);
public sealed record InstallProgress(string Message, double Fraction);
public sealed record InstalledClient(string Version, string Directory)
{
    public string Executable => Path.Combine(Directory, "RobloxPlayerBeta.exe");
}
public static partial class Deployment
{
    [GeneratedRegex(@"^[a-zA-Z0-9_-]{1,50}$")] private static partial Regex ChannelPattern();
    [GeneratedRegex(@"^version-[a-fA-F0-9]{16,64}$")] private static partial Regex VersionPattern();
    [GeneratedRegex(@"^[a-fA-F0-9]{32}$")] private static partial Regex HashPattern();
    // Roblox package layout, deliberately closed: unknown packages must be reviewed before install.
    public static readonly IReadOnlyDictionary<string, string> Directories = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["RobloxApp.zip"] = "", ["Libraries.zip"] = "", ["redist.zip"] = "", ["WebView2.zip"] = "",
        ["WebView2RuntimeInstaller.zip"] = "WebView2RuntimeInstaller", ["shaders.zip"] = "shaders", ["ssl.zip"] = "ssl",
        ["content-avatar.zip"] = "content/avatar", ["content-configs.zip"] = "content/configs", ["content-fonts.zip"] = "content/fonts",
        ["content-sky.zip"] = "content/sky", ["content-sounds.zip"] = "content/sounds", ["content-textures2.zip"] = "content/textures",
        ["content-models.zip"] = "content/models", ["content-textures3.zip"] = "PlatformContent/pc/textures", ["content-terrain.zip"] = "PlatformContent/pc/terrain",
        ["content-platform-fonts.zip"] = "PlatformContent/pc/fonts", ["content-platform-dictionaries.zip"] = "PlatformContent/pc/shared_compression_dictionaries",
        ["extracontent-luapackages.zip"] = "ExtraContent/LuaPackages", ["extracontent-translations.zip"] = "ExtraContent/translations",
        ["extracontent-models.zip"] = "ExtraContent/models", ["extracontent-textures.zip"] = "ExtraContent/textures", ["extracontent-places.zip"] = "ExtraContent/places"
    };
    public static string ValidateChannel(string channel) => ChannelPattern().IsMatch(channel) ? channel : throw new ArgumentException("Invalid Roblox channel.");
    public static string ValidateVersion(string version) => VersionPattern().IsMatch(version) ? version : throw new InvalidDataException("Invalid Roblox version identifier.");
    public static IReadOnlyList<Package> ParseManifest(string input)
    {
        if (input.Length > 1_000_000) throw new InvalidDataException("Manifest is too large.");
        using var reader = new StringReader(input);
        if (reader.ReadLine() != "v0") throw new InvalidDataException("Unsupported Roblox package manifest.");
        var result = new List<Package>(); var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (reader.ReadLine() is { } name)
        {
            if (name.Length == 0) continue;
            var hash = reader.ReadLine(); var packed = reader.ReadLine(); var unpacked = reader.ReadLine();
            if (hash is null || packed is null || unpacked is null || !HashPattern().IsMatch(hash) || !long.TryParse(packed, out var p) || !long.TryParse(unpacked, out var u) || p is <= 0 or > 2_000_000_000 || u is <= 0 or > 4_000_000_000) throw new InvalidDataException("Invalid package manifest entry.");
            if (!names.Add(name)) throw new InvalidDataException("Duplicate Roblox package.");
            // Roblox lists standalone bootstrappers alongside the Player ZIPs. Orbit
            // installs those ZIPs itself; these executables are not archives to extract.
            if (name.Equals("RobloxPlayerLauncher.exe", StringComparison.OrdinalIgnoreCase)
                || name.Equals("RobloxPlayerInstaller.exe", StringComparison.OrdinalIgnoreCase)) continue;
            if (!Directories.ContainsKey(name)) throw new InvalidDataException($"Unrecognized Roblox package '{name}'. Update Orbit before installing this client.");
            result.Add(new(name, hash.ToLowerInvariant(), p, u));
        }
        if (result.Count == 0 || !names.Contains("RobloxApp.zip") || result.Sum(p => p.UnpackedSize) > 14_000_000_000) throw new InvalidDataException("Incomplete or oversized Roblox manifest.");
        return result;
    }
    public static string SafePath(string root, string relative)
    {
        // Reject both Windows and Unix absolute/drive/ADS paths even when tests run on Linux.
        if (string.IsNullOrWhiteSpace(relative) || relative.Contains(':') || relative.StartsWith('/') || relative.StartsWith('\\')) throw new InvalidDataException("Unsafe package path.");
        var segments = relative.Replace('\\', '/').Split('/');
        if (segments.Any(p => p is "." or ".." || p.EndsWith(' ') || p.EndsWith('.') || p.Any(c => c < 32 || "<>|?*".Contains(c)) || ReservedName(p))) throw new InvalidDataException("Unsafe package path.");
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('\\', Path.DirectorySeparatorChar)));
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Package escapes installation directory.");
        return full;
    }
    private static bool ReservedName(string segment)
    {
        var stem = segment.Split('.')[0].ToUpperInvariant();
        return stem is "CON" or "PRN" or "AUX" or "NUL" || stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) && stem[3] is >= '1' and <= '9';
    }
    public static async Task ExtractAsync(Stream zipStream, string root, long expectedSize, CancellationToken ct)
    {
        using var zip = new ZipArchive(zipStream, ZipArchiveMode.Read, leaveOpen: true);
        if (zip.Entries.Count > 100_000) throw new InvalidDataException("Too many archive entries.");
        long written = 0;
        foreach (var e in zip.Entries)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                if (((e.ExternalAttributes >> 16) & 0xF000) == 0xA000) throw new InvalidDataException("Links are not permitted in packages.");
                var relative = e.FullName;
                var directory = relative.EndsWith('/') || relative.EndsWith('\\');
                if (directory && e.Length != 0) throw new InvalidDataException("Directory entries cannot contain file data.");
                // Roblox's ZIP writer emits DOS directory records named "\\" and
                // "\\folder\\", while their files use relative names. Interpret only
                // these zero-byte, directory-flagged records relative to this package.
                // Ordinary rooted files, UNC paths and traversal remain rejected.
                if (directory && (e.ExternalAttributes & 0x10) != 0 && relative.StartsWith('\\') && !relative.StartsWith("\\\\", StringComparison.Ordinal))
                {
                    relative = relative[1..];
                    if (relative.Length == 0) { Directory.CreateDirectory(root); continue; }
                }
                var path = SafePath(root, relative);
                if (directory) { Directory.CreateDirectory(path); continue; }
                written = checked(written + e.Length);
                if (written > expectedSize || e.Length > 2_000_000_000) throw new InvalidDataException("Archive exceeds declared size.");
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                await using var input = e.Open(); await using var output = new FileStream(path, FileMode.Create, FileAccess.Write);
                await input.CopyToAsync(output, ct);
            }
            catch (InvalidDataException error)
            {
                var label = e.FullName.Length > 160 ? e.FullName[..160] + "…" : e.FullName;
                throw new InvalidDataException($"Archive entry '{label.Replace("\r", "\\r").Replace("\n", "\\n")}': {error.Message}", error);
            }
        }
        if (written != expectedSize) throw new InvalidDataException("Archive size does not match its manifest.");
    }
}
public sealed class RobloxInstaller(HttpClient http, string root, Func<string, bool> verifyPublisher)
{
    public string Root => root;
    private readonly SemaphoreSlim gate = new(1);
    public async Task<ClientVersion> LatestAsync(string channel, CancellationToken ct)
    {
        Deployment.ValidateChannel(channel);
        var url = $"https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer/channel/{channel}";
        var version = await http.GetFromJsonAsync<ClientVersion>(url, WorkspaceStore.Json, ct) ?? throw new InvalidDataException("No Roblox version returned.");
        Deployment.ValidateVersion(version.ClientVersionUpload); return version;
    }
    public InstalledClient? Current()
    {
        var pointer = Path.Combine(root, "current.txt");
        if (!File.Exists(pointer)) return null;
        var version = Deployment.ValidateVersion(File.ReadAllText(pointer).Trim());
        var client = new InstalledClient(version, Path.Combine(root, "versions", version));
        return File.Exists(client.Executable) ? client : null;
    }
    public async Task<InstalledClient> EnsureAsync(string channel, bool update, bool repair, IProgress<InstallProgress>? progress, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            Directory.CreateDirectory(root);
            // Also serializes separate Orbit processes. Never replace an in-use client tree.
            await using var installationLock = new FileStream(Path.Combine(root, "install.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            var current = Current();
            if (!update && !repair && current is not null) { Verify(current); return current; }
            progress?.Report(new("Checking Roblox channel…", 0));
            var latest = await LatestAsync(channel, ct); var version = latest.ClientVersionUpload;
            if (!repair && current?.Version == version) { Verify(current); progress?.Report(new("Roblox is up to date.", 1)); return current; }
            var manifest = Deployment.ParseManifest(await http.GetStringAsync($"https://setup.rbxcdn.com/{version}-rbxPkgManifest.txt", ct));
            var required = manifest.Sum(p => p.UnpackedSize + p.PackedSize) + 512L * 1024 * 1024;
            var drive = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(root))!);
            if (drive.AvailableFreeSpace < required) throw new IOException("Not enough disk space to install Roblox safely.");
            var versions = Path.Combine(root, "versions"); Directory.CreateDirectory(versions);
            var destination = Path.Combine(versions, version);
            var stage = Path.Combine(versions, ".install-" + Guid.NewGuid()); Directory.CreateDirectory(stage);
            try
            {
                long total = manifest.Sum(p => p.PackedSize), done = 0;
                foreach (var p in manifest)
                {
                    ct.ThrowIfCancellationRequested(); progress?.Report(new($"Downloading {p.Name}", (double)done / total));
                    var archive = Path.Combine(stage, ".download.zip");
                    try
                    {
                        using var response = await http.GetAsync($"https://setup.rbxcdn.com/{version}-{p.Name}", HttpCompletionOption.ResponseHeadersRead, ct); response.EnsureSuccessStatusCode();
                        if (response.Content.Headers.ContentLength is { } size && size != p.PackedSize) throw new InvalidDataException("Package download size mismatch.");
                        await using (var input = await response.Content.ReadAsStreamAsync(ct))
                        await using (var output = new FileStream(archive, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        {
                            var buffer = new byte[65536]; long received = 0; int n;
                            while ((n = await input.ReadAsync(buffer, ct)) > 0)
                            {
                                received += n; if (received > p.PackedSize) throw new InvalidDataException("Package exceeds declared size.");
                                await output.WriteAsync(buffer.AsMemory(0, n), ct);
                                progress?.Report(new($"Downloading {p.Name}", (double)(done + received) / total));
                            }
                            if (received != p.PackedSize) throw new InvalidDataException("Incomplete package download.");
                        }
                        await using var downloaded = File.OpenRead(archive);
                        // MD5 is Roblox's manifest integrity format. HTTPS + Authenticode establish origin.
                        var hash = Convert.ToHexString(await MD5.HashDataAsync(downloaded, ct));
                        if (!hash.Equals(p.Md5, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Roblox package checksum mismatch.");
                        downloaded.Position = 0;
                        var target = Deployment.Directories[p.Name].Length == 0 ? stage : Deployment.SafePath(stage, Deployment.Directories[p.Name]);
                        await Deployment.ExtractAsync(downloaded, target, p.UnpackedSize, ct);
                    }
                    catch (InvalidDataException error) { throw new InvalidDataException($"{p.Name}: {error.Message}", error); }
                    finally { if (File.Exists(archive)) File.Delete(archive); }
                    done += p.PackedSize;
                }
                var staged = new InstalledClient(version, stage); Verify(staged);
                await File.WriteAllTextAsync(Path.Combine(stage, "AppSettings.xml"), "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Settings><ContentFolder>content</ContentFolder><BaseUrl>http://www.roblox.com</BaseUrl></Settings>", ct);
                ct.ThrowIfCancellationRequested();
                if (Directory.Exists(destination))
                {
                    var old = destination + ".previous-" + Guid.NewGuid();
                    Directory.Move(destination, old);
                    try { Directory.Move(stage, destination); } catch { Directory.Move(old, destination); throw; }
                    // Keep last tree for recovery. User-triggered cleanup can remove it when no game is open.
                }
                else Directory.Move(stage, destination);
                var pointer = Path.Combine(root, "current.txt"); await File.WriteAllTextAsync(pointer + ".tmp", version, ct);
                File.Move(pointer + ".tmp", pointer, true);
                progress?.Report(new("Roblox is ready.", 1)); return new(version, destination);
            }
            finally { if (Directory.Exists(stage)) Directory.Delete(stage, true); }
        }
        finally { gate.Release(); }
    }
    private void Verify(InstalledClient c)
    {
        if (!File.Exists(c.Executable) || !verifyPublisher(c.Executable)) throw new InvalidDataException("Roblox Player is missing or its publisher signature is invalid.");
    }
}
