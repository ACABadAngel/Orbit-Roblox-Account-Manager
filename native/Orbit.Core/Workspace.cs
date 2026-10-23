using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Orbit.Core;

public class Observable : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    protected void Changed([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new(name));
    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    { if (EqualityComparer<T>.Default.Equals(field, value)) return false; field = value; Changed(name); return true; }
}
public sealed class Account : Observable
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public long UserId { get; set; }
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Alias { get; set; } = "";
    public string Group { get; set; } = "Main";
    public string ProfileId { get; set; } = "default";
    public string Notes { get; set; } = "";
    public double Volume { get; set; } = 1;
    public bool Muted { get; set; }
    [JsonIgnore] public string Label => string.IsNullOrWhiteSpace(Alias) ? Username : Alias;
    private string status = "Idle", error = "";
    [JsonIgnore] public string Status { get => status; set => Set(ref status, value); }
    [JsonIgnore] public string Error { get => error; set => Set(ref error, value); }
    [JsonIgnore] public int ProcessId { get; set; }
    [JsonIgnore] public DateTime ProcessStart { get; set; }
    [JsonIgnore] public nint Window { get; set; }
    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }
}
public sealed class LaunchProfile
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "Default";
    public string PlaceId { get; set; } = "";
    public string JobId { get; set; } = "";
    public Dictionary<string, JsonElement> FastFlags { get; set; } = [];
    public override string ToString() => Name;
}
public sealed class LauncherSettings
{
    public string Channel { get; set; } = "live";
    public bool UpdateBeforeLaunch { get; set; } = true;
    public bool MultiSession { get; set; } = true;
    public int LaunchDelaySeconds { get; set; } = 5;
    public string CurrentVersion { get; set; } = "";
    public Dictionary<string, JsonElement> FastFlags { get; set; } = [];
}
public sealed class Workspace
{
    public int Version { get; set; } = 2;
    public List<Account> Accounts { get; set; } = [];
    public List<string> Groups { get; set; } = ["Main", "Trading", "Testing"];
    public List<LaunchProfile> Profiles { get; set; } = [new() { Id = "default" }];
    public LauncherSettings Launcher { get; set; } = new();
    public List<string> Activity { get; set; } = [];
    public void Validate()
    {
        if (Version != 2 || Accounts is null || Accounts.Count > 5000 || Profiles is null || Profiles.Count > 100 || Profiles.Count == 0 || Groups is null || Launcher is null) throw new InvalidDataException("Unsupported or damaged native workspace.");
        if (Accounts.Select(a => a.Id).Distinct().Count() != Accounts.Count || Accounts.Any(a => !Guid.TryParse(a.Id, out _) || a.UserId <= 0 || string.IsNullOrWhiteSpace(a.Username) || a.Username.Length > 40)) throw new InvalidDataException("Invalid account records.");
        if (Launcher.LaunchDelaySeconds is < 0 or > 120) throw new InvalidDataException("Launch delay must be 0–120 seconds.");
        Deployment.ValidateChannel(Launcher.Channel);
        foreach (var p in Profiles) LaunchUri.ValidateProfile(p);
    }
}
public interface ISecretProtector { byte[] Protect(byte[] data); byte[] Unprotect(byte[] data); }

// A single atomically replaced, OS-protected envelope prevents metadata/vault generations diverging.
// Uses a separate data directory: the Electron workspace and vault are never rewritten.
public sealed class WorkspaceStore(string directory, ISecretProtector protector)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly SemaphoreSlim gate = new(1);
    public string DirectoryPath => directory;
    public Workspace State { get; private set; } = new();
    private Dictionary<string, string> sessions = [];
    private sealed record Envelope(Workspace State, Dictionary<string, string> Sessions);
    public void PutSession(string id, string value) => sessions[id] = value;
    public string Session(string id) => sessions.GetValueOrDefault(id) ?? throw new InvalidOperationException("Sign in to this account again.");
    public void Remove(Account a) { State.Accounts.Remove(a); sessions.Remove(a.Id); }
    public Task LoadAsync()
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "workspace.dpapi");
        if (!File.Exists(path)) return Task.CompletedTask;
        Envelope e;
        try { e = Read(path); }
        catch (Exception primary) when (primary is not OutOfMemoryException)
        {
            if (!File.Exists(path + ".bak")) throw new InvalidDataException("Cannot unlock native workspace. No data was overwritten.", primary);
            try { e = Read(path + ".bak"); }
            catch (Exception backup) when (backup is not OutOfMemoryException) { throw new InvalidDataException("Native workspace and backup cannot be unlocked. No data was overwritten.", backup); }
            // Preserve damaged primary for manual recovery, then restore the known-good generation.
            File.Copy(path, path + ".damaged-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss"), true);
            File.Copy(path + ".bak", path, true);
        }
        State = e.State; sessions = e.Sessions; return Task.CompletedTask;
    }
    private Envelope Read(string path)
    {
        if (new FileInfo(path).Length > 50_000_000) throw new InvalidDataException("Workspace is too large.");
        var bytes = protector.Unprotect(File.ReadAllBytes(path));
        try { var e = JsonSerializer.Deserialize<Envelope>(bytes, Json) ?? throw new InvalidDataException("Empty workspace."); e.State.Validate(); return e; }
        finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(bytes); }
    }
    public async Task SaveAsync()
    {
        await gate.WaitAsync();
        try
        {
            State.Validate(); Directory.CreateDirectory(directory);
            var plain = JsonSerializer.SerializeToUtf8Bytes(new Envelope(State, sessions), Json);
            byte[] encrypted;
            try { encrypted = protector.Protect(plain); } finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(plain); }
            var path = Path.Combine(directory, "workspace.dpapi"); var temporary = path + ".tmp";
            await using (var f = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { await f.WriteAsync(encrypted); f.Flush(true); }
            if (File.Exists(path)) File.Replace(temporary, path, path + ".bak"); else File.Move(temporary, path);
        }
        finally { gate.Release(); }
    }
    public void Log(string message)
    {
        State.Activity.Insert(0, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}");
        if (State.Activity.Count > 1000) State.Activity.RemoveRange(1000, State.Activity.Count - 1000);
    }
}
