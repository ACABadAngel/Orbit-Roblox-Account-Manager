using System.Text.Json.Serialization;
namespace Orbit.Core;
public sealed partial class Account
{
    public bool AutoRelaunch { get; set; } = true;
    public string ServerId { get; set; } = "";
    [JsonIgnore] public bool AudioApplied {get;set;}
    [JsonIgnore] public bool StopRequested { get; set; }
    [JsonIgnore] public Queue<DateTimeOffset> RecoveryAttempts { get; } = new();
    [JsonIgnore] public DateTimeOffset? RecoverAt { get; set; }
    private string resources="";
    [JsonIgnore] public string Resources { get=>resources;set=>Set(ref resources,value); }
}
public sealed class GroupOptions
{
    public string ProfileId { get; set; } = "";
    public int DelaySeconds { get; set; } = 5;
    public bool AutoRelaunch { get; set; }
    public int RecoveryDelaySeconds { get; set; } = 10;
    public string ServerMode { get; set; } = "none";
    public List<string> ServerIds { get; set; } = [];
}
public sealed class PrivateServer
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "Private server";
    public string PlaceId { get; set; } = "";
    public string Target { get; set; } = "";
    public override string ToString() => Name;
}
public sealed class Automation
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "Session";
    public string Action { get; set; } = "launch";
    public List<string> AccountIds { get; set; } = [];
    public DateTimeOffset? At { get; set; }
    public string Repeat { get; set; } = "once";
    public string State { get; set; } = "pending";
    public override string ToString() => Name;
    public void Validate()
    {
        if (Name.Length is < 1 or > 80 || Action is not ("launch" or "stop") || Repeat is not ("once" or "daily" or "weekly") || AccountIds.Count is < 1 or > 5000 || AccountIds.Any(id=>!Guid.TryParse(id,out _))) throw new InvalidDataException("Invalid schedule or workflow.");
    }
    public static DateTimeOffset? Next(DateTimeOffset at, string repeat, DateTimeOffset now)
    {
        if (repeat == "once") return null;
        if (repeat is not ("daily" or "weekly")) throw new ArgumentException("Invalid recurrence.");
        var local = at.LocalDateTime; do { local = local.AddDays(repeat == "daily" ? 1 : 7); } while (new DateTimeOffset(local) <= now);
        return new DateTimeOffset(local);
    }
}
public sealed class WindowSlot
{
    public string AccountId { get; set; } = "";
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; } = .5;
    public double Height { get; set; } = .5;
}
public sealed class SavedLayout
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "My layout";
    public string Monitor { get; set; } = "";
    public bool AutoApply { get; set; }
    public List<WindowSlot> Slots { get; set; } = [];
    public void Validate()
    {
        if (Name.Length is < 1 or > 80 || Slots.Count > 5000 || Slots.Select(s=>s.AccountId).Distinct().Count() != Slots.Count || Slots.Any(s=> !Guid.TryParse(s.AccountId,out _) || !double.IsFinite(s.X+s.Y+s.Width+s.Height) || s.X < 0 || s.Y < 0 || s.Width < .02 || s.Height < .02 || s.X+s.Width > 1.001 || s.Y+s.Height > 1.001)) throw new InvalidDataException("Layout slots must fit inside the monitor.");
    }
    public override string ToString() => Name;
}
public sealed class PairedMachine
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "My PC";
    public string Address { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public string Token { get; set; } = "";
    public override string ToString() => Name;
}
public sealed class HostOptions
{
    public bool Enabled { get; set; }
    public bool Lan { get; set; }
    public bool AllowInput { get; set; }
    public int Port { get; set; } = 43129;
    public int StreamFps { get; set; } = 60;
    public int StreamHeight { get; set; } = 720;
    public string Token { get; set; } = "";
    public string Certificate { get; set; } = "";
}
public sealed class LicenseOptions
{
    public string Provider { get; set; } = "keyauth";
    public string DeviceId { get; set; } = Guid.NewGuid().ToString();
    public string AppName { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string AppVersion { get; set; } = "1.0";
    public string Key { get; set; } = "";
    public string Endpoint { get; set; } = "";
    public string PublicKey { get; set; } = "";
    public string Receipt { get; set; } = "";
    public long LastSeenAt { get; set; }
}
public sealed partial class Workspace
{
    public Dictionary<string,GroupOptions> GroupSettings { get; set; } = [];
    public List<PrivateServer> PrivateServers { get; set; } = [];
    public List<Automation> Schedules { get; set; } = [];
    public List<Automation> Workflows { get; set; } = [];
    public List<SavedLayout> Layouts { get; set; } = [];
    public List<PairedMachine> Machines { get; set; } = [];
    public HostOptions Host { get; set; } = new();
    public LicenseOptions License { get; set; } = new();
    public bool MinimizeToTray { get; set; }
    public bool LightTheme { get; set; }
    public bool CheckUpdates { get; set; } = true;
    public string UpdateChannel { get; set; } = "stable";
    private void ValidateExtended()
    {
        if (GroupSettings is null || PrivateServers is null || Schedules is null || Workflows is null || Layouts is null || Machines is null || Host is null || License is null || PrivateServers.Count>500 || Schedules.Count>1000 || Workflows.Count>100 || Layouts.Count>50 || Machines.Count>100 || Host.Port is <1024 or >65535 || Host.StreamFps is not (30 or 60) || Host.StreamHeight is not (480 or 720 or 1080)) throw new InvalidDataException("Invalid workspace settings.");
        foreach(var g in GroupSettings.Values) if(g.DelaySeconds is <0 or >120 || g.RecoveryDelaySeconds is <5 or >300 || g.ServerMode is not ("none" or "round-robin" or "assigned") || g.ServerIds.Count>500) throw new InvalidDataException("Invalid group launch settings.");
        foreach(var a in Accounts) if(!double.IsFinite(a.Volume) || a.Volume is <0 or >1) throw new InvalidDataException("Invalid account volume.");
        foreach(var server in PrivateServers){if(server.Name.Length is <1 or >80 || server.PlaceId.Length==0 || server.Target.Length is <8 or >2048)throw new InvalidDataException("Invalid private server.");LaunchUri.ValidateProfile(new(){PlaceId=server.PlaceId});}
        foreach(var s in Schedules.Concat(Workflows)) s.Validate();
        foreach(var l in Layouts) l.Validate();
    }
    public GroupOptions OptionsFor(Account a) => GroupSettings.GetValueOrDefault(a.Group) ?? new(){DelaySeconds=Launcher.LaunchDelaySeconds};
}
