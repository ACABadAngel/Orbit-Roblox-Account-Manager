using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Generators;
namespace Orbit.Core;
public sealed record BackupData(Workspace State, Dictionary<string,string> Sessions);
public static class BackupService
{
    public static string Encrypt(BackupData data, string password)
    {
        if(password.Length is <12 or >1024) throw new ArgumentException("Use a backup passphrase of 12–1024 characters.");
        var salt=RandomNumberGenerator.GetBytes(16);var nonce=RandomNumberGenerator.GetBytes(12);var key=Rfc2898DeriveBytes.Pbkdf2(password,salt,600_000,HashAlgorithmName.SHA256,32);
        var plain=JsonSerializer.SerializeToUtf8Bytes(data,WorkspaceStore.Json);var cipher=new byte[plain.Length];var tag=new byte[16];
        try{using var aes=new AesGcm(key,16);aes.Encrypt(nonce,plain,cipher,tag);return JsonSerializer.Serialize(new{format="orbit-native-backup-v2",salt=Convert.ToBase64String(salt),iv=Convert.ToBase64String(nonce),tag=Convert.ToBase64String(tag),data=Convert.ToBase64String(cipher)});}
        finally{CryptographicOperations.ZeroMemory(key);CryptographicOperations.ZeroMemory(plain);}
    }
    public static BackupData Decrypt(string text,string password)
    {
        if(text.Length>50_000_000 || password.Length>1024)throw new InvalidDataException("Backup is too large.");
        try
        {
            using var doc=JsonDocument.Parse(text);var e=doc.RootElement;var format=e.GetProperty("format").GetString();
            var salt=Convert.FromBase64String(e.GetProperty("salt").GetString()!);var iv=Convert.FromBase64String(e.GetProperty("iv").GetString()!);var tag=Convert.FromBase64String(e.GetProperty("tag").GetString()!);var cipher=Convert.FromBase64String(e.GetProperty("data").GetString()!);
            if(salt.Length!=16 || iv.Length!=12 || tag.Length!=16)throw new InvalidDataException();
            var key=format switch{"orbit-native-backup-v2"=>Rfc2898DeriveBytes.Pbkdf2(password,salt,600_000,HashAlgorithmName.SHA256,32),"orbit-backup-v1"=>SCrypt.Generate(Encoding.UTF8.GetBytes(password),salt,16384,8,1,32),_=>throw new InvalidDataException()};
            var plain=new byte[cipher.Length];
            try
            {
                using var aes=new AesGcm(key,16);aes.Decrypt(iv,cipher,tag,plain);
                var result=format=="orbit-backup-v1"?Legacy(plain):JsonSerializer.Deserialize<BackupData>(plain,WorkspaceStore.Json)??throw new InvalidDataException();
                result.State.Validate();
                if(result.Sessions.Any(p=>p.Value.Length is <20 or >20000 || p.Value.Contains('\r')||p.Value.Contains('\n')||p.Value.Contains(';')))throw new InvalidDataException();
                return result;
            }
            finally{CryptographicOperations.ZeroMemory(key);CryptographicOperations.ZeroMemory(plain);}
        }
        catch(Exception e) when(e is not OutOfMemoryException){throw new InvalidDataException("Wrong passphrase or damaged/unsupported backup.");}
    }
    private static BackupData Legacy(byte[] bytes)
    {
        using var doc=JsonDocument.Parse(bytes);var root=doc.RootElement;var old=root.GetProperty("state");
        if(old.GetProperty("version").GetInt32()!=1)throw new InvalidDataException();
        var state=new Workspace();state.Accounts=old.GetProperty("accounts").Deserialize<List<Account>>(WorkspaceStore.Json)??[];
        foreach(var a in state.Accounts)if(a.Extra is not null&&a.Extra.TryGetValue("audio",out var audio)){if(audio.TryGetProperty("volume",out var volume))a.Volume=volume.GetDouble();if(audio.TryGetProperty("muted",out var muted))a.Muted=muted.GetBoolean();}
        state.Groups=old.GetProperty("groups").Deserialize<List<string>>()??["Main"];
        state.Profiles=old.GetProperty("profiles").Deserialize<List<LaunchProfile>>(WorkspaceStore.Json)??[new(){Id="default"}];
        if(old.TryGetProperty("settings",out var settings))
        {if(settings.TryGetProperty("launchDelayMs",out var delay))state.Launcher.LaunchDelaySeconds=Math.Clamp(delay.GetInt32()/1000,0,120);}
        var secrets=root.GetProperty("secrets");var sessions=secrets.GetProperty("accounts").Deserialize<Dictionary<string,string>>()??[];
        if(old.TryGetProperty("privateServers",out var servers)&&secrets.TryGetProperty("privateServers",out var targets))foreach(var server in servers.EnumerateArray())
        {
            var id=server.GetProperty("id").GetString()!;if(!targets.TryGetProperty(id,out var target))continue;
            state.PrivateServers.Add(new(){Id=id,Name=server.GetProperty("name").GetString()!,PlaceId=server.GetProperty("placeId").GetString()!,Target=target.TryGetProperty("url",out var url)?url.GetString()!:target.GetProperty("accessCode").GetString()!});
        }
        if(old.TryGetProperty("groupSettings",out var rules))foreach(var g in rules.EnumerateObject())
        {var v=g.Value;state.GroupSettings[g.Name]=new(){ProfileId=v.TryGetProperty("profileId",out var p)?p.GetString()??"":"",DelaySeconds=v.TryGetProperty("launchDelayMs",out var d)?Math.Clamp(d.GetInt32()/1000,0,120):5,AutoRelaunch=v.TryGetProperty("autoRelaunch",out var a)&&a.GetBoolean(),RecoveryDelaySeconds=v.TryGetProperty("relaunchDelayMs",out var r)?Math.Clamp(r.GetInt32()/1000,5,300):10,ServerMode=v.TryGetProperty("serverMode",out var mode)?mode.GetString()??"none":"none",ServerIds=v.TryGetProperty("serverIds",out var ids)?ids.Deserialize<List<string>>()??[]:[]};}
        if(old.TryGetProperty("layouts",out var layouts))foreach(var l in layouts.EnumerateArray())
        {var layout=l.Deserialize<SavedLayout>(WorkspaceStore.Json);if(layout is not null){layout.AutoApply=false;state.Layouts.Add(layout);}}
        foreach(var kind in new[]{"schedules","workflows"})if(old.TryGetProperty(kind,out var tasks))foreach(var t in tasks.EnumerateArray())
        {var node=System.Text.Json.Nodes.JsonNode.Parse(t.GetRawText())!.AsObject();node.Remove("at");var task=node.Deserialize<Automation>(WorkspaceStore.Json);if(task is null)continue;task.Repeat=t.TryGetProperty("recurrence",out var repeat)?repeat.GetString()??"once":"once";task.At=t.TryGetProperty("at",out var at)&&at.TryGetInt64(out var ms)?DateTimeOffset.FromUnixTimeMilliseconds(ms):null;task.State="paused";(kind=="schedules"?state.Schedules:state.Workflows).Add(task);}
        return new(state,sessions);
    }
    public static BackupData Export(WorkspaceStore store)
    {
        var state=JsonSerializer.Deserialize<Workspace>(JsonSerializer.Serialize(store.State,WorkspaceStore.Json),WorkspaceStore.Json)!;
        state.Machines=[];state.Host=new();state.License=new();return new(state,store.AccountSessions());
    }
    public static int Merge(WorkspaceStore store,BackupData backup)
    {
        backup.State.Validate();var incoming=JsonSerializer.Deserialize<Workspace>(JsonSerializer.Serialize(backup.State,WorkspaceStore.Json),WorkspaceStore.Json)!;
        var current=JsonSerializer.Deserialize<Workspace>(JsonSerializer.Serialize(store.State,WorkspaceStore.Json),WorkspaceStore.Json)!;var added=new List<Account>();var profileMap=new Dictionary<string,string>();
        foreach(var p in incoming.Profiles)
        {
            var collision=current.Profiles.FirstOrDefault(x=>x.Id==p.Id);var original=p.Id;
            if(collision is not null&&JsonSerializer.Serialize(collision,WorkspaceStore.Json)!=JsonSerializer.Serialize(p,WorkspaceStore.Json)){p.Id=Guid.NewGuid().ToString();profileMap[original]=p.Id;current.Profiles.Add(p);}else if(collision is null)current.Profiles.Add(p);
        }
        foreach(var a in incoming.Accounts)
        {if(current.Accounts.Any(x=>x.Id==a.Id||x.UserId==a.UserId))continue;a.Window=0;a.Status="Idle";if(profileMap.TryGetValue(a.ProfileId,out var replacement))a.ProfileId=replacement;current.Accounts.Add(a);added.Add(a);}
        foreach(var g in incoming.Groups)if(!current.Groups.Contains(g))current.Groups.Add(g);
        foreach(var s in incoming.PrivateServers)if(!current.PrivateServers.Any(x=>x.Id==s.Id))current.PrivateServers.Add(s);
        foreach(var g in incoming.GroupSettings){if(profileMap.TryGetValue(g.Value.ProfileId,out var replacement))g.Value.ProfileId=replacement;current.GroupSettings.TryAdd(g.Key,g.Value);}
        foreach(var l in incoming.Layouts)if(!current.Layouts.Any(x=>x.Id==l.Id)){l.AutoApply=false;current.Layouts.Add(l);}
        foreach(var task in incoming.Workflows)if(!current.Workflows.Any(x=>x.Id==task.Id))current.Workflows.Add(task);
        foreach(var task in incoming.Schedules)if(!current.Schedules.Any(x=>x.Id==task.Id)){task.State="paused";current.Schedules.Add(task);}
        current.Validate();
        // Retain live runtime identities of records already open in this workspace.
        for(var i=0;i<current.Accounts.Count;i++){var previous=store.State.Accounts.FirstOrDefault(a=>a.Id==current.Accounts[i].Id);if(previous is not null)current.Accounts[i]=previous;}
        store.ReplaceState(current);foreach(var a in added)if(backup.Sessions.TryGetValue(a.Id,out var secret))store.PutSession(a.Id,secret);return added.Count;
    }
}
