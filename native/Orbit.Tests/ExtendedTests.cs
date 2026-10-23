using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Orbit.Core;
using Org.BouncyCastle.Crypto.Generators;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;
public static class ExtendedTests
{
    private static void Assert(bool value){if(!value)throw new Exception("Assertion failed");}
    private static void Reject(Action action){try{action();}catch(Exception e)when(e is InvalidDataException or ArgumentException or InvalidOperationException){return;}throw new Exception("Invalid value accepted");}
    private static string Root(){var d=Path.Combine(Path.GetTempPath(),"orbit-extra-"+Guid.NewGuid());Directory.CreateDirectory(d);return d;}
    private static (Ed25519PrivateKeyParameters Private,Ed25519PublicKeyParameters Public) Key(){var key=new Ed25519PrivateKeyParameters(new SecureRandom());return(key,key.GeneratePublicKey());}
    private static byte[] Sign(byte[] bytes,Ed25519PrivateKeyParameters key){var signer=new Ed25519Signer();signer.Init(true,key);signer.BlockUpdate(bytes,0,bytes.Length);return signer.GenerateSignature();}
    public static void Register(Action<string,Func<Task>> add)
    {
        void Test(string name,Action run)=>add(name,()=>{run();return Task.CompletedTask;});
        Test("native encrypted backups round trip and reject changed ciphertext",()=>
        {
            var state=new Workspace();var a=new Account{UserId=123,Username="BackupUser"};state.Accounts.Add(a);var data=new BackupData(state,new(){{a.Id,new string('x',30)}});var encrypted=BackupService.Encrypt(data,"a-long-backup-passphrase");Assert(!encrypted.Contains("BackupUser"));var read=BackupService.Decrypt(encrypted,"a-long-backup-passphrase");Assert(read.State.Accounts.Single().Username=="BackupUser"&&read.Sessions[a.Id]==new string('x',30));Reject(()=>BackupService.Decrypt(encrypted,"wrong-password"));Reject(()=>BackupService.Encrypt(data,"short"));
        });
        Test("Electron v1 encrypted backups migrate through scrypt",()=>
        {
            var a=new Account{UserId=123,Username="LegacyUser"};var plain=JsonSerializer.SerializeToUtf8Bytes(new{state=new{version=1,accounts=new[]{a},groups=new[]{"Main"},profiles=new[]{new LaunchProfile{Id="default",PlaceId="123"}}},secrets=new{accounts=new Dictionary<string,string>{{a.Id,new string('s',30)}},privateServers=new{}}},WorkspaceStore.Json);var salt=RandomNumberGenerator.GetBytes(16);var iv=RandomNumberGenerator.GetBytes(12);var key=SCrypt.Generate(Encoding.UTF8.GetBytes("legacy-passphrase"),salt,16384,8,1,32);var cipher=new byte[plain.Length];var tag=new byte[16];using(var aes=new AesGcm(key,16))aes.Encrypt(iv,plain,cipher,tag);var text=JsonSerializer.Serialize(new{format="orbit-backup-v1",salt=Convert.ToBase64String(salt),iv=Convert.ToBase64String(iv),tag=Convert.ToBase64String(tag),data=Convert.ToBase64String(cipher)});var result=BackupService.Decrypt(text,"legacy-passphrase");Assert(result.State.Version==2&&result.State.Accounts[0].Username=="LegacyUser"&&result.State.Profiles[0].PlaceId=="123");
        });
        Test("backup merge remaps colliding profiles and preserves current sessions",()=>
        {
            var directory=Root();try{var store=new WorkspaceStore(directory,new TestProtector());var current=new Account{UserId=1,Username="Existing",Window=77};store.State.Accounts.Add(current);store.PutSession(current.Id,new string('a',30));var next=new Account{UserId=2,Username="Incoming",ProfileId="default"};var backup=new Workspace();backup.Profiles[0].PlaceId="123";backup.Accounts.Add(next);Assert(BackupService.Merge(store,new(backup,new(){{next.Id,new string('b',30)}}))==1);Assert(store.State.Accounts[0].Window==77&&store.State.Accounts[1].ProfileId!="default"&&store.Session(current.Id)==new string('a',30));}finally{Directory.Delete(directory,true);}
        });
        Test("backup exports omit pairing and licence secrets",()=>
        {
            var directory=Root();try{var store=new WorkspaceStore(directory,new TestProtector());store.State.Host.Token="host-secret";store.State.License.Key="licence-secret";store.State.Machines.Add(new(){Token="peer-secret"});var json=JsonSerializer.Serialize(BackupService.Export(store));Assert(!json.Contains("host-secret")&&!json.Contains("licence-secret")&&!json.Contains("peer-secret"));}finally{Directory.Delete(directory,true);}
        });
        Test("invalid merged backups leave the existing workspace untouched",()=>
        {
            var directory=Root();try{var store=new WorkspaceStore(directory,new TestProtector());store.State.Profiles=Enumerable.Range(0,60).Select(i=>new LaunchProfile{Id="current"+i,Name="Current"}).ToList();var backup=new Workspace{Profiles=Enumerable.Range(0,60).Select(i=>new LaunchProfile{Id="incoming"+i,Name="Incoming"}).ToList()};Reject(()=>BackupService.Merge(store,new(backup,[])));Assert(store.State.Profiles.Count==60);}finally{Directory.Delete(directory,true);}
        });
        Test("control leases reject wrong controllers and expire",()=>
        {
            var now=DateTimeOffset.UtcNow;var lease=new ControlLease(()=>now);var token=lease.Acquire("account-a");Assert(lease.Accept("account-a",token));Assert(!lease.Accept("account-b",token)&&!lease.Accept("account-a",new string('x',64)));Reject(()=>lease.Acquire("account-b"));now=now.AddSeconds(9);Assert(!lease.Accept("account-a",token));var next=lease.Acquire("account-b");Assert(next!=token);lease.Release();Assert(!lease.Active);
        });
        Test("machine origins and pins reject credential or path injection",()=>
        {foreach(var bad in new[]{"http://localhost:1234","https://user:pass@host/","https://host/path","https://host/?x=1","https://host/#hash"})Reject(()=>RemoteSecurity.Address(bad));Assert(RemoteSecurity.Address("https://127.0.0.1:43129").Port==43129);Reject(()=>RemoteSecurity.Fingerprint("ABCD"));Assert(RemoteSecurity.Fingerprint(string.Join(':',Enumerable.Repeat("ab",32)))==new string('A',1)+"B"+string.Concat(Enumerable.Repeat("AB",31)));Assert(!RemoteSecurity.TokenMatches("short","short"));});
        Test("automation validates actions and skips past recurrences",()=>
        {var a=new Automation{AccountIds=[Guid.NewGuid().ToString()],Action="launch"};a.Validate();a.Action="execute";Reject(a.Validate);var now=DateTimeOffset.Now;var next=Automation.Next(now.AddDays(-4),"daily",now);Assert(next>now&&next<now.AddDays(2));Assert(Automation.Next(now,"once",now)==null);});
        Test("saved layouts reject duplicate, non-finite and out-of-monitor slots",()=>
        {var id=Guid.NewGuid().ToString();new SavedLayout{Slots=[new(){AccountId=id,X=.1,Y=.1,Width=.5,Height=.5}]}.Validate();Reject(()=>new SavedLayout{Slots=[new(){AccountId=id,X=.8,Width=.5}]}.Validate());Reject(()=>new SavedLayout{Slots=[new(){AccountId=id,X=double.NaN}]}.Validate());Reject(()=>new SavedLayout{Slots=[new(){AccountId=id},new(){AccountId=id}]}.Validate());});
        Test("private-server links are restricted to their Roblox place",()=>
        {Assert(PrivateServers.ValidateLink("https://www.roblox.com/games/123?privateServerLinkCode=abcdefgh","123").Host=="www.roblox.com");foreach(var bad in new[]{"https://evil.test/games/123","https://roblox.com.evil.test/games/123","https://www.roblox.com/games/124","http://www.roblox.com/games/123","https://user@www.roblox.com/games/123"})Reject(()=>PrivateServers.ValidateLink(bad,"123"));var uri=Uri.UnescapeDataString(LaunchUri.Build("ticket",new(){PlaceId="123"},target:new("abcdefgh","linkcode")));Assert(uri.Contains("request=RequestPrivateGame&placeId=123&accessCode=abcdefgh&linkCode=linkcode"));});
        Test("KeyAuth verifies Ed25519 over timestamp and body",()=>
        {var key=Key();var now=DateTimeOffset.UtcNow;var timestamp=now.ToUnixTimeSeconds().ToString();var bytes=Encoding.UTF8.GetBytes("{\"success\":true}");var signature=Convert.ToHexString(Sign([..Encoding.ASCII.GetBytes(timestamp),..bytes],key.Private));var pub=Convert.ToHexString(key.Public.GetEncoded());Assert(LicenseSignatures.KeyAuth(bytes,signature,timestamp,now,pub).GetProperty("success").GetBoolean());Reject(()=>LicenseSignatures.KeyAuth(bytes,signature,timestamp,now.AddMinutes(1),pub));try{LicenseSignatures.KeyAuth(Encoding.UTF8.GetBytes("{}"),signature,timestamp,now,pub);}catch(InvalidDataException){return;}throw new Exception("Tampered response accepted");});
        Test("feature overrides can remove a paid entitlement",()=>
        {var grant=LicenseSignatures.WithOverrides(LicenseSignatures.Grant("pro",null,DateTimeOffset.UtcNow.AddHours(1)),new Dictionary<string,bool>{{"remoteControl",false}});Assert(!grant.Has("remoteControl")&&grant.Has("workflows")&&grant.Devices==5);Reject(()=>LicenseSignatures.WithOverrides(grant,new Dictionary<string,bool>{{"unknown",true}}));});
        Test("native updates only accept this repository’s release assets",()=>
        {NativeUpdate.ValidateUrl("https://github.com/ACABadAngel/Orbit-Roblox-Account-Manager/releases/download/native-v0.6.2/Orbit-Native-win-x64.zip");foreach(var url in new[]{"https://evil.test/app.zip","http://github.com/ACABadAngel/Orbit-Roblox-Account-Manager/releases/download/x/app.zip","https://github.com/other/repo/releases/download/x/app.zip"})Reject(()=>NativeUpdate.ValidateUrl(url));});
        Test("CSV and explicit cookie imports never return passwords",()=>
        {var token="_|WARNING:"+new string('t',30);var values=RobloxApi.ParseSessions("username,cookie\nuser,\""+token+"\"\n.ROBLOSECURITY="+token+"; Path=/");Assert(values.Count==1&&values[0]==token);Reject(()=>RobloxApi.ParseSessions("username,password"));});
    }
}
